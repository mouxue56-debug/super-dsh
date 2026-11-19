# shell · 界面壳

手机优先的网页界面，纯静态（HTML/CSS/JS），没有依赖、不用 npm。

```sh
python3 build.py                    # 打出 dist-generic/DSH-Hub.html，单个文件，离线可用
open dist-generic/DSH-Hub.html      # 直接双击也行；里面是虚构的演示数据，不连任何后台
```

- 源码在 `js/`、`css/`、`modules/`；`index.html` 是入口，`build.py` 把它们内联成一个文件（只用 Python 标准库）。
- 两种运行方式：演示（自带假数据）和真实（`document.documentElement.dataset.hubMode==='real'`，数据由 `hub/packages/hub-web/hub-real.js` 这个适配层提供）。
- 图标是 `tools/make_icons.py` 用纯 Python 画的几何团子，不含第三方素材。
- 测试在 `test/`：多数要浏览器（需要自己装 playwright-core 和 Chromium，并用环境变量 `PLAYWRIGHT_CORE`、`CHROMIUM` 指路）；
  少数要 jsdom（环境变量 `JSDOM_MODULE`）。纯 Node 的几个可以直接跑，见仓库根 `docs/安装.md` 的「跑测试」。
