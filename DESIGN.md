# DESIGN.md

## 项目与用户画像
AI商家带货视频生成工具，面向电商商家、带货主播，提供一键生成带货短视频的能力。

## 品牌与视觉方向
- **风格关键词**：专业、现代、简洁、高效
- **主色调**：蓝色到紫色的渐变（科技感、信任感）
- **辅助色**：绿色到青色渐变（成功、下载按钮）

## Design Tokens

### 色彩
- 主色：蓝色-紫色渐变 (`from-blue-600 to-purple-600`)
- 成功色：绿色-青色渐变 (`from-green-600 to-teal-600`)
- 背景：浅蓝到白色的渐变 (`from-blue-50 via-white to-purple-50`)

### 组件规范
- 卡片：白色背景，80%透明度，磨砂玻璃效果（`backdrop-blur`）
- 按钮：大尺寸（`size="lg"`），圆角，渐变背景
- 输入框：灰色边框，圆角
- 进度条：蓝色，高度2px

### 布局与响应式
- 最大宽度：`max-w-4xl`
- 内边距：`px-4 py-8`
- 间距：使用Tailwind的间距系统（gap-2, gap-4等）

### 图标
- 使用 Lucide React 图标库
- 主要图标：Video, Upload, Sparkles, FileText, Download, Loader2, CheckCircle2, Circle
