import argparse
from pathlib import Path

from .database import import_papers
from .zotero_service import read_papers


def main() -> None:
    backend_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="将 Zotero 文献导入研知图数据库")
    parser.add_argument(
        "--zotero-root",
        type=Path,
        default=Path.home() / "Zotero",
        help="Zotero 数据目录，用于定位本地 PDF",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=backend_dir / "data" / "yanzhitu.sqlite3",
        help="研知图 SQLite 数据库路径",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="只导入最近修改的前 N 篇文献"
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="只读取并统计，不写数据库"
    )
    args = parser.parse_args()

    try:
        papers, collections = read_papers(args.zotero_root, args.limit)
    except RuntimeError as error:
        raise SystemExit(f"导入失败：{error}") from error
    author_count = len({author.id for paper in papers for author in paper.authors})
    pdf_count = sum(len(paper.attachments) for paper in papers)
    print(f"读取文献：{len(papers)}")
    print(f"关联作者：{author_count}")
    print(f"PDF 附件：{pdf_count}")

    if not args.dry_run:
        imported = import_papers(args.database, papers, collections)
        print(f"已写入：{imported}")
        print(f"数据库：{args.database}")


if __name__ == "__main__":
    main()
