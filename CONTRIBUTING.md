# 参与贡献

感谢你参与 PortLens。贡献可以是 Bug 报告、功能建议、文档改进、测试或代码修改。

## 提交 Issue 前

- 搜索现有 Issues，避免重复提交。
- Bug 报告请提供 Windows 版本、PortLens 版本、复现步骤、预期行为和实际行为。
- 日志、截图和命令行中可能包含用户名、本地路径或项目名称，请先删除敏感信息。
- 安全漏洞不要提交公开 Issue，请遵循 [SECURITY.md](SECURITY.md)。

## 本地开发

环境要求和运行方式见 [README.md](README.md#开发环境)。首次安装依赖：

```powershell
npm ci
```

启动应用：

```powershell
npm run tauri dev
```

## 提交修改

1. Fork 仓库并从默认分支创建新分支。
2. 保持改动范围清晰，不要混入无关格式化或重构。
3. 为行为变化补充测试，或在 Pull Request 中说明无法测试的原因。
4. 在提交前完成本地验证。
5. 创建 Pull Request，说明问题、实现方式、风险和验证结果。

建议的验证命令：

```powershell
npm run build
```

```powershell
cd src-tauri
cargo test
cd ..
```

涉及 Rust 的修改还应通过：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
```

## 代码约定

- 优先沿用现有 React、TypeScript 和 Rust 代码风格。
- 用户可见文案目前使用简体中文。
- 不要提交 `node_modules/`、`dist/`、`src-tauri/target/`、日志或构建生成的 `.exe`。
- 进程结束逻辑属于高风险区域；修改保护规则时必须补充测试并清楚说明安全影响。
- 新依赖需要说明用途、维护状态和无法使用现有实现的原因。

## Pull Request 要求

一个可评审的 Pull Request 应包含：

- 清楚的问题描述和修改动机
- 主要实现说明
- 验证命令与结果
- 界面变更的截图或录屏
- 已知限制、兼容性影响或后续工作

维护者可能要求缩小改动范围、补充测试或调整实现。提交贡献即表示你同意按项目的 [MIT License](LICENSE) 授权你的贡献。
