# app.js 模块化拆分进度

> 最后更新: 2026-01-30

## 📊 拆分概览

原始文件: `public/music/app.js` (15,206 行)

目标: 按功能职责拆分为多个独立模块,提升可维护性和可读性

---

## ✅ 已完成模块

### 1. constants.js - 常量定义模块 (95 行)
**文件位置**: `public/music/js/constants.js`

**功能**:
- PAGINATION: 分页相关常量
- TIMEOUT: 超时相关常量
- ANIMATION: 动画与 UI 延迟常量
- API: API 路径常量
- PLAYBACK: 播放控制常量

**导出**:
```javascript
window.PAGINATION, window.TIMEOUT, window.ANIMATION, window.API, window.PLAYBACK, window.API_BASE
```

---

### 2. utils.js - 通用工具函数模块 (256 行)
**文件位置**: `public/music/js/utils.js`

**功能**:
- `createPagination()`: 通用分页器状态管理
- `updateLibPaginationUI()`: 分页控件 UI 更新
- `navigatePage()`: 分页导航(上/下页)
- `goToPage()`: 跳转到指定页
- `changePageSize()`: 分页大小变更
- `filterList()`: 列表过滤
- `sortList()`: 列表排序
- `formatTime()`: 时间格式化 (秒 → mm:ss)
- `formatDuration()`: 时长格式化 (秒 → 中文描述)

**导出**:
```javascript
window.createPagination, window.updateLibPaginationUI, window.navigatePage, 
window.goToPage, window.changePageSize, window.filterList, window.sortList,
window.formatTime, window.formatDuration
```

---

### 3. settings.js - 设置管理模块 (261 行)
**文件位置**: `public/music/js/settings.js`

**功能**:
- DEFAULT_SETTINGS: 所有设置项的默认值
- settings: 当前设置对象(从 localStorage 加载)
- 歌词数据状态: currentRawLrc, currentRawTlrc, currentRawRlrc, currentRawKlrc
- `updateSetting()`: 更新设置项(同步内存+localStorage+UI)
- `handleSettingChange()`: 设置变更后的特殊处理
- `resetSettingsToDefault()`: 重置所有设置
- `exportSettings()`: 导出设置为 JSON
- `importSettings()`: 从 JSON 导入设置

**导出**:
```javascript
window.DEFAULT_SETTINGS, window.settings, window.updateSetting, 
window.resetSettingsToDefault, window.exportSettings, window.importSettings,
window.currentRawLrc, window.currentRawTlrc, window.currentRawRlrc, 
window.currentRawKlrc, window.lastLyricSongId
```

---

### 4. auth.js - 认证管理模块 (220 行)
**文件位置**: `public/music/js/auth.js`

**功能**:
- 认证状态: authEnabled, authToken, userToken
- `getUserAuthHeaders()`: 生成 API 认证 Headers
- `isAuthenticated()`: 检查是否已认证
- `getCurrentToken()`: 获取当前 Token
- `initAuthentication()`: 初始化认证系统(DOMContentLoaded 自动执行)
- `verifyUserToken()`: 验证 Token 有效性
- `handleLogout()`: 处理用户登出
- `setUserToken()`: 设置用户 Token
- `clearUserToken()`: 清除用户 Token

**导出**:
```javascript
window.getUserAuthHeaders, window.isAuthenticated, window.getCurrentToken,
window.initAuthentication, window.verifyUserToken, window.handleLogout,
window.setUserToken, window.clearUserToken
```

---

### 5. ui-controls.js - UI 交互控制模块 (402 行)
**文件位置**: `public/music/js/ui-controls.js`

**功能**:
- 拖拽控制: startDragging(), stopDragging(), handleDragMove()
- 进度条拖拽: handleProgressDrag()
- 音量条拖拽: handleVolumeDrag()
- 按钮状态: startExpandBtnTimer(), startToggleLyricsBtnTimer()
- 侧边栏: toggleSidebar(), toggleSidebarCollapse()
- 代理设置: changeProxyPlayback(), changeProxyDownload(), changeAutoProxy(), 
  changeCustomProxy(), changeCustomProxyUrl()
- 其他设置: changeHotSearchLimit()
- UI 初始化: initUIControls() (DOMContentLoaded 自动执行)

**导出**:
```javascript
window.startDragging, window.stopDragging, window.handleDragMove,
window.toggleSidebar, window.toggleSidebarCollapse,
window.changeProxyPlayback, window.changeProxyDownload, window.changeAutoProxy,
window.changeCustomProxy, window.changeCustomProxyUrl, window.changeHotSearchLimit,
window.initUIControls, window.startExpandBtnTimer, window.startToggleLyricsBtnTimer
```

---

### 6. queue.js - 播放队列管理模块 (358 行)
**文件位置**: `public/music/js/queue.js`

**功能**:
- `toggleQueueDrawer()`: 切换队列抽屉显示/隐藏
- `scrollToCurrentSongInQueue()`: 定位当前播放歌曲
- `renderQueue()`: 渲染播放队列(自动选择正常/虚拟滚动)
- `renderQueueVirtual()`: 虚拟滚动渲染(超过 200 首时启用)
- `initQueueSortable()`: 初始化队列拖拽排序
- `removeFromQueue()`: 从队列中移除歌曲
- `playSongFromQueue()`: 从队列中点击播放歌曲

**导出**:
```javascript
window.toggleQueueDrawer, window.scrollToCurrentSongInQueue, window.renderQueue,
window.renderQueueVirtual, window.removeFromQueue, window.playSongFromQueue
```

---

## 🔄 待拆分模块

### 7. playback.js - 播放控制核心模块 (~2000 行)
**计划拆分内容**:
- playSong(): 核心播放函数
- togglePlay(): 播放/暂停切换
- playNextSong(), playPrevSong(): 上/下一首
- playMode 管理(顺序/随机/单曲循环)
- shuffleOrder 随机播放系统
- audio 事件监听(ended, error, timeupdate)
- 播放进度控制
- 音量控制
- DLNA/UPNP 投屏播放逻辑

**依赖**: constants.js, utils.js, settings.js, auth.js

---

### 8. musiclib.js - 音乐库管理模块 (~1800 行)
**计划拆分内容**:
- loadMusicLib(): 加载音乐库
- renderMusicLibList(): 渲染音乐库列表
- filterMusicLib(), sortMusicLib(): 过滤和排序
- playMusicLibSong(): 播放音乐库歌曲
- 音乐库分页控制
- 音乐库搜索
- 音乐库删除歌曲
- 音乐库刷新

**依赖**: constants.js, utils.js, settings.js, auth.js, playback.js

---

### 9. albumlib.js - 专辑库管理模块 (~700 行)
**计划拆分内容**:
- loadAlbumLib(): 加载专辑库
- renderAlbumLibList(): 渲染专辑列表
- openAlbumDetail(), closeAlbumDetail(): 专辑详情开关
- renderAlbumDetailList(): 渲染专辑详情
- playAlbumSong(), playAllAlbumSongs(): 专辑播放
- completeAlbumSongs(): 专辑补全
- downloadVirtualSongs(): 下载虚拟歌曲
- refreshAlbumDetail(): 刷新专辑详情
- _switchToAlbum(): 切换到其他专辑

**依赖**: constants.js, utils.js, settings.js, auth.js, playback.js

---

### 10. search.js - 搜索功能模块 (~600 行)
**计划拆分内容**:
- doSearch(): 执行搜索
- renderResults(): 渲染搜索结果
- 搜索历史管理
- 热搜列表
- 搜索播放逻辑
- 搜索分页

**依赖**: constants.js, utils.js, settings.js, auth.js, playback.js

---

## 📝 加载顺序

```html
<!-- 基础层 -->
<script src="/download/js/constants.js"></script>
<script src="/download/js/utils.js"></script>

<!-- 业务层 -->
<script src="/download/js/settings.js"></script>
<script src="/download/js/auth.js"></script>
<script src="/download/js/ui-controls.js"></script>
<script src="/download/js/queue.js"></script>

<!-- 待添加 -->
<!-- <script src="/music/js/playback.js"></script> -->
<!-- <script src="/music/js/musiclib.js"></script> -->
<!-- <script src="/music/js/albumlib.js"></script> -->
<!-- <script src="/music/js/search.js"></script> -->

<!-- 主入口 (逐渐精简) -->
<script src="/download/app.js"></script>
```

---

## 🎯 拆分原则

1. **按功能职责分离** - 每个模块独立管理自己的状态和逻辑
2. **依赖注入** - 通过 `window` 对象暴露公共 API,避免循环依赖
3. **向后兼容** - 保持所有全局函数签名不变,不影响现有代码
4. **渐进式迁移** - 先拆分独立模块,最后重构主文件
5. **中文注释** - 所有模块、函数、关键逻辑都添加详细中文注释

---

## 📈 拆分进度

- ✅ 基础层: constants.js, utils.js (100%)
- ✅ 业务层: settings.js, auth.js, ui-controls.js, queue.js (100%)
- ⏳ 核心层: playback.js, musiclib.js, albumlib.js, search.js (0%)
- ⏳ 集成层: app.js 精简 (0%)

**当前代码量**:
- 已拆分: ~1,592 行 (6 个模块)
- 待拆分: ~5,100 行 (4 个模块)
- app.js 剩余: ~8,514 行 (待后续精简至 ~3,000 行)

---

## 🔍 测试验证清单

### 基础功能测试
- [ ] 页面正常加载,无控制台错误
- [ ] 设置面板正常显示和保存
- [ ] 用户登录/登出功能正常
- [ ] 进度条拖拽流畅
- [ ] 音量条拖拽流畅
- [ ] 侧边栏展开/收缩正常
- [ ] 播放队列抽屉正常打开/关闭
- [ ] 队列拖拽排序正常

### 播放功能测试
- [ ] 音乐库加载和播放
- [ ] 专辑库加载和播放
- [ ] 搜索功能正常
- [ ] 播放模式切换(顺序/随机/单曲)
- [ ] 上/下一首切换
- [ ] DLNA 投屏正常

### 性能测试
- [ ] 首次加载时间无明显增加
- [ ] 内存占用合理
- [ ] 虚拟滚动在大数据量时流畅

---

## 🚀 后续优化方向

1. **ES Module 迁移** - 将全局 window 挂载改为 import/export
2. **TypeScript 重构** - 为模块添加类型定义
3. **构建工具引入** - 使用 Vite/Rollup 进行模块打包
4. **按需加载** - 使用动态 import 实现代码分割
5. **单元测试** - 为每个模块编写测试用例

---

## 📚 相关文档

- [AGENTS.md](../AGENTS.md) - 项目指引
- [.qoder/index.md](../.qoder/index.md) - 函数索引
- [DEC-007](../.qoder/decisions.md) - 前端超大文件不拆分决策(已调整)

> **注意**: 本次拆分遵循 DEC-007 决策的"不引入构建工具"原则,使用原生 JS 模块加载方式。
