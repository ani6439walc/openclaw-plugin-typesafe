import importlib.util
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("jules_pr_review.py")
WORKFLOW = SCRIPT.parents[1] / "workflows" / "jules-pr-review.yml"

spec = importlib.util.spec_from_file_location("jules_pr_review", SCRIPT)
assert spec and spec.loader
jules_pr_review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jules_pr_review)


class JulesPrReviewTest(unittest.TestCase):
    def test_workflow_grants_contents_write_for_temporary_diff_branch(self):
        self.assertIn("  contents: write\n", WORKFLOW.read_text(encoding="utf-8"))

    def test_workflow_concurrency_group_is_per_pr(self):
        workflow_text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("group: jules-pr-review-${{ github.event.pull_request.number }}\n", workflow_text)
        self.assertNotIn("group: jules-pr-review-${{ github.event.pull_request.number }}-${{ github.event.pull_request.head.sha }}", workflow_text)

    def test_workflow_author_association_allows_owner_member_collaborator(self):
        workflow_text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('contains(fromJSON(\'["OWNER", "MEMBER", "COLLABORATOR"]\'), github.event.pull_request.author_association)', workflow_text)

    def test_workflow_includes_always_cleanup_step(self):
        workflow_text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("name: Cleanup temporary diff branch\n        if: always()", workflow_text)
        self.assertIn("git push origin --delete", workflow_text)

    def test_activities_follow_pagination(self):
        pages = [
            {"activities": [{"id": "1"}], "nextPageToken": "next/token"},
            {"activities": [{"id": "2"}]},
        ]
        with mock.patch.object(jules_pr_review, "request", side_effect=pages) as request:
            with mock.patch.dict(os.environ, {"JULES_API_KEY": "synthetic"}):
                result = jules_pr_review.get_jules_activities("sessions/test")
        self.assertEqual([item["id"] for item in result["activities"]], ["1", "2"])
        self.assertIn("pageToken=next%2Ftoken", request.call_args_list[1].args[1])

    def test_extracts_complete_review_instead_of_later_status_message(self):
        review = "### Summary\nReview\n### Blocking Issues\nNone\n### Verdict\nApprove"
        activities = {"activities": [
            {"agentMessaged": {"agentMessage": review}},
            {"agentMessaged": {"agentMessage": "All done."}},
        ]}
        self.assertEqual(jules_pr_review.extract_review_from_activities(activities), review)

    def test_missing_key_fails_before_network_or_branch_writes(self):
        with mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "owner/repo", "PR_NUMBER": "2", "JULES_API_KEY": ""}):
            with mock.patch.object(jules_pr_review, "get_pr_diff") as fetch:
                with self.assertRaisesRegex(SystemExit, "JULES_API_KEY"):
                    jules_pr_review.main()
                fetch.assert_not_called()

    def test_workflow_excludes_cross_repository_prs(self):
        self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", WORKFLOW.read_text())

    def test_discovers_source_name_from_connected_repositories(self):
        pages = [
            {"sources": [], "nextPageToken": "page-two"},
            {"sources": [{"name": "sources/opaque-id", "githubRepo": {"owner": "Owner", "repo": "Repo"}}]},
        ]
        with mock.patch.object(jules_pr_review, "request", side_effect=pages):
            with mock.patch.dict(os.environ, {"JULES_API_KEY": "synthetic"}):
                self.assertEqual(jules_pr_review.find_jules_source("owner", "repo"), "sources/opaque-id")

    def test_missing_repository_connection_is_actionable(self):
        with mock.patch.object(jules_pr_review, "request", return_value={"sources": []}):
            with mock.patch.dict(os.environ, {"JULES_API_KEY": "synthetic"}):
                with self.assertRaisesRegex(RuntimeError, "Connect owner/repo to Jules"):
                    jules_pr_review.find_jules_source("owner", "repo")

    def test_status_messages_are_not_reviews(self):
        self.assertIsNone(jules_pr_review.extract_review_from_activities({
            "activities": [{"agentMessaged": {"agentMessage": "Summary: checking issues"}}]
        }))

    def test_status_message_with_all_keywords_is_not_a_complete_review(self):
        self.assertIsNone(jules_pr_review.extract_review_from_activities({
            "activities": [{"agentMessaged": {"agentMessage": "Summary: I will check blocking issues and provide a verdict later"}}]
        }))

    def test_large_diff_recovery_reads_fetch_head(self):
        env = {"PR_NUMBER": "2", "PR_TITLE": "Test", "BASE_REF": "main", "HEAD_SHA": "abc", "PR_URL": "https://example.test/pr/2", "JULES_API_KEY": "synthetic"}
        with mock.patch.dict(os.environ, env):
            with mock.patch.object(jules_pr_review, "find_jules_source", return_value="sources/test"):
                with mock.patch.object(jules_pr_review, "request") as request:
                    jules_pr_review.create_jules_session("owner", "repo", "x" * (jules_pr_review.MAX_DIFF_CHARS + 1), "temp/pr-2-diff-1-1")
        self.assertTrue("git show FETCH_HEAD:pr-2-full.diff" in request.call_args.args[3]["prompt"])

    def test_temporary_branch_is_owned_by_this_workflow_run(self):
        branch = "temp/pr-2-diff-123-2"
        with mock.patch.dict(os.environ, {"DIFF_BRANCH": branch}):
            with mock.patch.object(jules_pr_review.subprocess, "run", return_value=mock.Mock(stdout="abc")):
                with mock.patch.object(jules_pr_review, "ensure_git_config"):
                    with mock.patch("builtins.open", mock.mock_open()):
                        with mock.patch.object(jules_pr_review, "push_diff_branch") as push:
                            self.assertEqual(jules_pr_review.create_diff_branch("2", "synthetic"), branch)
                            push.assert_called_once_with(branch)
        workflow = WORKFLOW.read_text()
        self.assertIn("github.run_id", workflow)
        self.assertIn("github.run_attempt", workflow)
        self.assertIn('git push origin --delete "$DIFF_BRANCH"', workflow)
        self.assertNotIn("git branch -r", workflow)

    def test_normal_diff_path_uses_pinned_commits_not_mutable_pr_api(self):
        with mock.patch.dict(os.environ, {"BASE_SHA": "base-pinned", "HEAD_SHA": "head-pinned", "BASE_REF": "moved-main", "GITHUB_TOKEN": "synthetic"}):
            with mock.patch.object(jules_pr_review, "request", return_value="mutable PR diff") as request:
                with mock.patch.object(jules_pr_review.subprocess, "run", return_value=mock.Mock(stdout="pinned diff")) as run:
                    self.assertEqual(jules_pr_review.get_pr_diff(), "pinned diff")
        request.assert_not_called()
        self.assertEqual(run.call_args.args[0], ["git", "diff", "base-pinned...head-pinned"])
        self.assertEqual(run.call_args_list[0].args[0], ["git", "fetch", "origin", "base-pinned", "head-pinned"])

    def test_checkout_and_comment_permissions_match_review_contract(self):
        workflow = WORKFLOW.read_text()
        self.assertIn("ref: ${{ github.event.pull_request.head.sha }}", workflow)
        self.assertIn("  pull-requests: write\n", workflow)

    def test_bold_verdicts_are_complete_reviews(self):
        for verdict in ["**✅ Approve**", "**⚠️ Approve with comments**", "**❌ Request changes**", "__✅ Approve__"]:
            with self.subTest(verdict=verdict):
                review = "### Summary\nReview\n### 🔴 Blocking Issues\nNone\n### Verdict\n" + verdict
                self.assertEqual(jules_pr_review.extract_review_from_activities({
                    "activities": [{"agentMessaged": {"agentMessage": review}}]
                }), review)

    def test_failed_comment_delivery_preserves_review_in_step_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / "summary.md"
            with mock.patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary), "GITHUB_TOKEN": "synthetic"}):
                with mock.patch.object(jules_pr_review, "request", side_effect=RuntimeError("403 Resource not accessible by integration")):
                    with self.assertRaises(RuntimeError):
                        jules_pr_review.post_pr_comment("owner", "repo", "2", "Completed review")
            self.assertIn("Completed review", summary.read_text())

    def test_push_failure_reports_sanitized_git_output(self):
        github_token = "github-token-secret"
        jules_api_key = "jules-api-key-secret"
        error = subprocess.CalledProcessError(
            128,
            ["git", "push", "origin", "temp/pr-57-diff-1"],
            output=f"remote: rejected {github_token}",
            stderr=f"fatal: denied {jules_api_key}",
        )

        with mock.patch.dict(
            os.environ,
            {"GITHUB_TOKEN": github_token, "JULES_API_KEY": jules_api_key},
        ):
            with mock.patch.object(
                jules_pr_review.subprocess, "run", side_effect=error
            ):
                with self.assertRaisesRegex(
                    RuntimeError, "Failed to push temporary diff branch"
                ) as raised:
                    jules_pr_review.push_diff_branch("temp/pr-57-diff-1")

        message = str(raised.exception)
        self.assertIn("stdout: remote: rejected [REDACTED]", message)
        self.assertIn("stderr: fatal: denied [REDACTED]", message)
        self.assertNotIn(github_token, message)
        self.assertNotIn(jules_api_key, message)

    def test_request_wraps_network_error(self):
        import urllib.error
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("Connection refused")):
            with self.assertRaisesRegex(RuntimeError, "failed \\(network error\\)"):
                jules_pr_review.request("GET", "https://example.com")

    def test_ci_workflow_targets_main_and_runs_standard_checks(self):
        ci_workflow = SCRIPT.parents[1] / "workflows" / "ci.yml"
        self.assertTrue(ci_workflow.exists())
        ci_text = ci_workflow.read_text(encoding="utf-8")
        self.assertIn("branches: [main]", ci_text)
        self.assertIn("pnpm run typecheck", ci_text)
        self.assertIn("pnpm run test", ci_text)
        self.assertIn("pnpm run build", ci_text)


if __name__ == "__main__":
    unittest.main()
