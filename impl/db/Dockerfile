# 会社DB 全文検索（PGroonga・データモデル §6・ドメイン J）用のカスタム Postgres イメージ。
# base＝postgres:16（現在 Debian trixie）。既存 db_data ボリュームは trixie（glibc 2.41）で作成済みのため
# trixie に合わせて collation バージョン不一致を回避する。PGDG 版 PostgreSQL16 向けの pgroonga パッケージは
# `postgresql-16-pgdg-pgroonga`（`-pgroonga` 単体は PGDG では候補なし）。alpine は musl 差でボリューム非互換のため不可。
FROM postgres:16

# PGroonga を groonga apt リポジトリから導入（postgresql-16-pgroonga）。
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates lsb-release wget; \
    codename="$(lsb_release --codename --short)"; \
    wget -q "https://packages.groonga.org/debian/groonga-apt-source-latest-${codename}.deb"; \
    apt-get install -y -V "./groonga-apt-source-latest-${codename}.deb"; \
    rm -f "groonga-apt-source-latest-${codename}.deb"; \
    apt-get update; \
    apt-get install -y -V postgresql-16-pgdg-pgroonga; \
    apt-get purge -y --auto-remove wget; \
    rm -rf /var/lib/apt/lists/*
