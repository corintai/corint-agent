# 临时文件管理

## 概述

Corint Agent 使用统一的会话临时目录来管理所有临时文件，确保文件隔离和自动清理。

## 目录结构

```
/tmp/corint/
├── session_20260118_133233/
│   ├── tmp/                    # 临时文件目录（TMPDIR 指向这里）
│   │   ├── node-compile-cache/ # Node.js 编译缓存（可选）
│   │   └── *.py, *.sh, ...    # 用户临时文件
│   ├── tasks/                  # 后台任务输出目录（可选）
│   │   └── {task_id}.output   # 任务输出文件
│   └── hooks/                  # Hook 转录目录（可选）
│       └── {session_id}.transcript.txt
├── session_20260118_131750/
│   └── ...
└── ...
```

### 子目录说明

#### 1. tmp/ - 临时文件目录
- **用途**: 存储会话期间的临时文件
- **环境变量**: `TMPDIR` 指向此目录
- **创建时机**: 会话启动时自动创建
- **内容**:
  - 用户通过 Bash 工具创建的临时脚本（Python、Shell等）
  - 程序自动生成的临时文件（使用 tempfile 模块）
  - Node.js 编译缓存
- **代码位置**: `src/core/utils/session/sessionTempDir.ts`

#### 2. tasks/ - 后台任务输出目录
- **用途**: 存储后台运行任务的输出
- **创建时机**: 首次使用后台任务时（`run_in_background: true`）
- **文件格式**: `{task_id}.output`
- **内容**: 任务的标准输出和标准错误
- **代码位置**: `src/core/utils/log/taskOutputStore.ts`
- **使用示例**:
  ```typescript
  // 后台运行命令
  await Bash({
    command: 'npm run build',
    run_in_background: true  // 输出保存到 tasks/
  })
  ```

#### 3. hooks/ - Hook 转录目录
- **用途**: 存储 Hook 执行的会话转录
- **创建时机**: 首次使用 Hook 功能时
- **文件格式**: `{session_id}.transcript.txt`
- **内容**: 用户和助手的对话记录（用于 Hook 上下文）
- **代码位置**: `src/core/utils/session/kodeHooks/runtimeState.ts`

## 环境变量

- `TMPDIR`: 自动设置为当前会话的临时目录
  - 格式: `/tmp/corint/session_YYYYMMDD_HHMMSS/tmp/`
  - 在 `src/cli/utils/setup.ts` 中初始化
  - 所有子进程自动继承此环境变量

## 使用方式

### 1. 在代码中使用

```typescript
import { getSessionTempDir } from '@utils/session/sessionTempDir'

// 获取会话临时目录
const tempDir = getSessionTempDir()

// 创建临时文件
const tempFile = join(tempDir, 'my-temp-file.txt')
writeFileSync(tempFile, 'content')
```

### 2. 在 Bash 命令中使用

```typescript
// 使用 $TMPDIR 环境变量
await Bash({
  command: 'python3 $TMPDIR/script.py',
  description: 'Run Python script'
})

// 或使用绝对路径
await Bash({
  command: `python3 "${getSessionTempDir()}/script.py"`,
  description: 'Run Python script'
})
```

### 3. 在 Python 脚本中使用

```python
import os
import tempfile

# TMPDIR 环境变量自动指向会话临时目录
tmpdir = os.environ.get('TMPDIR')
print(f"临时目录: {tmpdir}")

# tempfile 模块会自动使用 TMPDIR
with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
    f.write("content")
    print(f"临时文件: {f.name}")
```

## 自动清理

### 清理策略

1. **会话目录清理**
   - 清理时间: 7天后
   - 清理范围: `/tmp/corint/session_*/`
   - 实现: `cleanupOldSessionDirs()` in `src/core/utils/session/cleanup.ts`

2. **消息文件清理**
   - 清理时间: 30天后
   - 清理范围: 日志和错误文件
   - 实现: `cleanupOldMessageFiles()` in `src/core/utils/session/cleanup.ts`

### 清理触发

- 在应用启动时自动触发（后台执行）
- 在 `src/cli/utils/setup.ts` 中调用：
  ```typescript
  cleanupOldMessageFilesInBackground()
  cleanupOldSessionDirsInBackground()
  ```

## 沙箱集成

临时目录已集成到沙箱系统中：

### macOS 沙箱

```typescript
// 在 buildMacosSandboxExecCommand 中
rules.push(`(allow file-write* (subpath "${tmpDir}") (${logTag}))`)
```

### Linux 沙箱 (bwrap)

```typescript
// 在 buildLinuxBwrapCommand 中
if (options.tmpDir) {
  args.push('--tmpfs', options.tmpDir)
}
```

## 最佳实践

### ✅ 推荐做法

1. **使用 $TMPDIR 环境变量**
   ```bash
   python3 $TMPDIR/script.py
   ```

2. **使用 getSessionTempDir() 函数**
   ```typescript
   const tempFile = join(getSessionTempDir(), 'file.txt')
   ```

3. **使用 expandTmpDirPath() 处理路径**
   ```typescript
   const expanded = expandTmpDirPath('$TMPDIR/file.txt')
   // 返回: /tmp/corint/session_xxx/tmp/file.txt
   ```

### ❌ 避免做法

1. **不要硬编码 /tmp 路径**
   ```typescript
   // ❌ 错误
   const tempFile = '/tmp/my-file.txt'

   // ✅ 正确
   const tempFile = join(getSessionTempDir(), 'my-file.txt')
   ```

2. **不要直接写入项目根目录**
   ```typescript
   // ❌ 错误
   writeFileSync('./temp-file.txt', 'content')

   // ✅ 正确
   writeFileSync(join(getSessionTempDir(), 'temp-file.txt'), 'content')
   ```

## 相关文件

- `src/core/utils/session/sessionTempDir.ts` - 会话临时目录管理
- `src/core/utils/session/cleanup.ts` - 自动清理功能
- `src/cli/utils/setup.ts` - 初始化和清理触发
- `src/core/utils/fs/file.ts` - 文件路径处理（expandTmpDirPath）
- `src/core/utils/bun/shell/sandbox.ts` - 沙箱集成
- `src/core/tools/system/BashTool/prompt.ts` - Bash 工具提示

## 故障排查

### 问题: 临时文件未使用会话目录

**检查步骤:**
1. 确认 `TMPDIR` 环境变量已设置
   ```bash
   echo $TMPDIR
   ```

2. 检查会话目录是否存在
   ```bash
   ls -la /tmp/corint/
   ```

3. 验证代码是否使用 `getSessionTempDir()`

### 问题: 会话目录未自动清理

**检查步骤:**
1. 查看清理日志
2. 确认 `cleanupOldSessionDirsInBackground()` 被调用
3. 检查目录修改时间
   ```bash
   find /tmp/corint -type d -name "session_*" -mtime +7
   ```

## 测试

运行测试验证临时文件管理：

```bash
# 单元测试
bun test src/core/utils/session/cleanup.test.ts

# 集成测试
bun test tests/integration/temp-file-management.test.ts
```
