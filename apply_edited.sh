#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
src="$DIR/index_edited.html"
dst="$DIR/index.html"
if [ ! -f "$src" ]; then
  echo "ERROR: index_edited.html が見つかりません"
  exit 1
fi
cp "$src" "$dst"
echo "OK: index.html を更新しました。git add/commit/push を実行してください。"
