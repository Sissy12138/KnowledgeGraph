import tempfile
import unittest
from pathlib import Path

from .database import connect
from .graph_service import get_graph
from .paper_repository import list_papers


class AuthorContributionRoleTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "roles.sqlite3"
        connection = connect(self.database_path)
        with connection:
            connection.execute(
                """
                INSERT INTO papers (
                    id, source_type, source_library_id, source_item_key,
                    item_type, title, status
                ) VALUES ('paper-1', 'manual', 0, 'paper-1',
                          'journalArticle', '作者角色测试', 'completed')
                """
            )
            for author_id, name in [
                ("author-first", "一作"),
                ("author-cofirst", "共同一作"),
                ("author-corresponding", "通讯作者"),
            ]:
                connection.execute(
                    """
                    INSERT INTO authors (id, source_type, source_creator_id, name)
                    VALUES (?, 'manual', ?, ?)
                    """,
                    (author_id, author_id, name),
                )
            connection.executemany(
                """
                INSERT INTO paper_authors (paper_id, author_id, role, position)
                VALUES ('paper-1', ?, ?, ?)
                """,
                [
                    ("author-first", "author", 0),
                    ("author-cofirst", "author", 1),
                    ("author-cofirst", "equalContribution", 1),
                    ("author-corresponding", "correspondingAuthor", 2),
                ],
            )
        connection.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_paper_api_normalizes_contribution_roles_without_duplicate_authors(self):
        page = list_papers(
            self.database_path, 1, 20, None, None, "year", "desc"
        )
        authors = {author["authorId"]: author for author in page["items"][0]["authors"]}

        self.assertEqual(len(authors), 3)
        self.assertEqual(authors["author-first"]["contributionRoles"], ["firstAuthor"])
        self.assertEqual(authors["author-cofirst"]["contributionRoles"], ["coFirstAuthor"])
        self.assertEqual(
            authors["author-corresponding"]["contributionRoles"],
            ["correspondingAuthor"],
        )

    def test_graph_deduplicates_papers_and_coauthor_edges_across_role_rows(self):
        graph = get_graph(self.database_path)
        cofirst = next(node for node in graph["nodes"] if node["id"] == "author-cofirst")
        authored = [
            edge for edge in graph["edges"]
            if edge["relationType"] == "authored" and edge["sourceId"] == "author-cofirst"
        ]

        self.assertEqual(cofirst["sourcePaperIds"], ["paper-1"])
        self.assertEqual(len(authored), 1)

    def test_graph_merges_exact_same_author_identity_across_papers(self):
        connection = connect(self.database_path)
        with connection:
            connection.execute(
                """
                INSERT INTO papers (
                    id, source_type, source_library_id, source_item_key,
                    item_type, title, status
                ) VALUES ('paper-2', 'manual', 0, 'paper-2',
                          'journalArticle', '第二篇论文', 'completed')
                """
            )
            connection.execute(
                """
                INSERT INTO authors (id, source_type, source_creator_id, name)
                VALUES ('author-first-copy', 'manual', 'author-first-copy', '一作')
                """
            )
            connection.execute(
                """
                INSERT INTO paper_authors (paper_id, author_id, role, position)
                VALUES ('paper-2', 'author-first-copy', 'author', 0)
                """
            )
        connection.close()

        graph = get_graph(self.database_path)
        matching = [node for node in graph["nodes"] if node["nodeType"] == "author" and node["label"] == "一作"]

        self.assertEqual(1, len(matching))
        self.assertEqual(["paper-1", "paper-2"], matching[0]["sourcePaperIds"])

    def test_graph_merges_middle_initial_variant_only_with_shared_coauthor(self):
        connection = connect(self.database_path)
        with connection:
            connection.executemany(
                """
                INSERT INTO papers (
                    id, source_type, source_library_id, source_item_key,
                    item_type, title, status
                ) VALUES (?, 'manual', 0, ?, 'journalArticle', ?, 'completed')
                """,
                [
                    ("paper-2", "paper-2", "中间名完整"),
                    ("paper-3", "paper-3", "中间名省略"),
                    ("paper-4", "paper-4", "无共同作者的同名作者"),
                ],
            )
            connection.executemany(
                """
                INSERT INTO authors (id, source_type, source_creator_id, name)
                VALUES (?, 'manual', ?, ?)
                """,
                [
                    ("author-scott-full", "author-scott-full", "Scott W. Linderman"),
                    ("author-scott-short", "author-scott-short", "Scott Linderman"),
                    ("author-scott-unrelated", "author-scott-unrelated", "Scott William Linderman"),
                    ("author-shared", "author-shared", "Shared Collaborator"),
                    ("author-unrelated", "author-unrelated", "Other Collaborator"),
                ],
            )
            connection.executemany(
                """
                INSERT INTO paper_authors (paper_id, author_id, role, position)
                VALUES (?, ?, 'author', ?)
                """,
                [
                    ("paper-2", "author-scott-full", 0),
                    ("paper-2", "author-shared", 1),
                    ("paper-3", "author-scott-short", 0),
                    ("paper-3", "author-shared", 1),
                    ("paper-4", "author-scott-unrelated", 0),
                    ("paper-4", "author-unrelated", 1),
                ],
            )
        connection.close()

        graph = get_graph(self.database_path)
        matching = [
            node for node in graph["nodes"]
            if node["nodeType"] == "author" and node["label"] == "Scott W. Linderman"
        ]

        self.assertEqual(1, len(matching))
        self.assertEqual(["paper-2", "paper-3"], matching[0]["sourcePaperIds"])
        short_name_nodes = [
            node for node in graph["nodes"]
            if node["nodeType"] == "author" and node["label"] == "Scott William Linderman"
        ]
        self.assertEqual(1, len(short_name_nodes))
        self.assertEqual(["paper-4"], short_name_nodes[0]["sourcePaperIds"])


if __name__ == "__main__":
    unittest.main()
