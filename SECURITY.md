# 安全政策

## 怎么报告漏洞

请用本仓库的 **Private vulnerability reporting**（仓库页 **Security → Report a vulnerability**）私下报告。
**不要在公开 issue 里贴可利用细节。** 一般的 bug、功能建议请照常开 issue。

## 安全模型一句话

- 权限层是**第二道门**，第一道是 DSH 内核沙箱加一个专用的低权限系统用户；不要只靠本项目去关住一个能动手的助理。
- 默认只听 `127.0.0.1`；请只在你信任的私有网络里使用，**不要把端口暴露到公网**。
- 全开档下，花钱、对外发送、删除、上线或动线上服务这四类一定先问主人。
- 详细说明和已知限制见 [docs/安全与权限.md](docs/安全与权限.md)。

English: please use this repository's **Private vulnerability reporting** (Security → Report a vulnerability) and do not post
exploitable details in public issues. The permission layer is the second gate; the first gate is the DSH kernel sandbox plus a
dedicated low-privilege user. Do not expose the web service to the public internet.

## 支持的版本

0.2.0-beta 阶段只维护最新版本。
