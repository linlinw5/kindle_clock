# 提取字体子集字符表

## 安装 poetry，并安装必要的依赖

https://python-poetry.org/

poetry install

## 从阿里巴巴普惠体字体库中提取必要的字符

在仓库根目录运行：

```sh
uv run --no-project --python 3.14 --with "fonttools>=4.61,<5" python fontTool/build_font.py
```

也可以在本目录安装 Poetry 依赖后运行 `poetry run python build_font.py`。

脚本会保留 `chars.txt` 和旧字体中的字符，自动加入 `config.js` 中全部城市中文名，以及 `network.js` 中状态提示的汉字和中文标点，在内存中生成并验证字符覆盖后，直接写入 `css/PuHuiTiMin.ttf`。不再在 `fontTool` 中输出字体，也无需手工复制。以后增加城市或修改状态提示后重新运行即可。

如需手工提取（不会自动更新城市字符），在本目录运行，输出也直接放入 `css`：

```sh
pyftsubset Alibaba-PuHuiTi-Heavy.ttf --text-file=chars.txt --output-file=../css/PuHuiTiMin.ttf --layout-features='*'
```

## 天气描述用字

天气描述用字统一放在 `chars.txt` 中，已补充毛毛雨、冻雨、碎云、冰霰、沙尘旋涡、火山灰等用字。以后遇到缺字，直接添加到 `chars.txt` 后重新运行脚本即可。
