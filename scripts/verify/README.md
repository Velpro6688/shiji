# 回归测试

测试使用独立 profile，结果写入 `scripts/verify/results/`，不会提交个人存档。

执行 `npm ci` 和 `npm run electron:install` 后，可运行：

- `npm run check`：版本及语法检查。
- `npm run lint -- --max-warnings=0`：静态检查。
- `npm run verify:all`：数据、交互、窗口和保存回归。
- `npm run verify:todo`、`npm run verify:onboarding`、`npm run verify:corners`：对应专项检查。
- `npm run verify:packed-ui`：构建后的界面资源检查。

部分测试模拟系统 IPC；通知、自启动和桌面层级仍需实际 Windows 环境确认。系统剪贴板测试会暂时使用剪贴板并尝试恢复，测试期间请避免复制其他内容。
