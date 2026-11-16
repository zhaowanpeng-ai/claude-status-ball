# TODO

## 暂缓

- [ ] **手机端泡泡**（2026-11-16 暂缓，暂不实现）
  - 现状：桌面端、远端 SSH 和 Windows 本地 hook 已完成；手机端需求暂时搁置。
  - 可选路线与粗估：
    - 通知优先（ntfy / Bark / Telegram）：2–4 小时，只有系统通知，没有泡泡 UI。
    - 手机网页（SSE/WebSocket）：4–8 小时，只在页面打开时显示。
    - PWA + relay + Web Push：16–24 小时，可安装、可后台通知，泡泡只在应用内。
    - Android 悬浮球（Flutter/原生 + 前台服务）：24–40 小时，可跨 App 悬浮。
    - iOS Live Activity（Swift + APNs）：24–40 小时，只能锁屏/灵动岛，不能跨 App 悬浮。
  - 重新启动前需要确定：Android 还是 iOS；通知、应用内状态页还是系统级悬浮；是否能接受公网 relay 及其隐私边界。
