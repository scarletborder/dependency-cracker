# 模块依赖分析工具



这是一个用于分析 TypeScript/React 项目中模块导入和导出关系的实用工具。它可以从一个入口文件开始，递归地遍历所有相关的本地依赖，并生成一个结构化的分析报告，详细说明每个文件的导入、默认导出和命名导出。

## ✨ 功能特性

*   **全面的语法支持**:
    *   **导入**: 支持 ES6 的 `import` (命名、默认、命名空间、别名、副作用导入)、TypeScript 的 `type` 和 `import type`、CommonJS 的 `require` 以及动态 `import()` 表达式。
    *   **导出**: 支持 `export` (命名、默认、别名)、`export default` 表达式、声明并导出 (`export const/class/function` 等) 以及各种重导出 (`export { ... } from '...'`, `export * from '...'`)。

*   **递归分析**:
    *   从指定的入口文件开始，自动解析所有相对路径 (`./` 或 `../`) 的导入，并将其加入分析队列。
    *   能够处理模块间的循环依赖关系，确保每个文件只被分析一次。

*   **智能路径解析**:
    *   能够自动解析没有扩展名的导入路径，会依次尝试 `.ts`, `.tsx`, `.js`, `.jsx` 等常见扩展名。
    *   支持目录导入，能够自动查找并解析目录下的 `index` 文件。

*   **结构化输出**:
    *   分析结果以 `Map` 的形式返回，键为文件的绝对路径，值为该文件的详细分析结果。
    *   结果类型定义清晰，使用 `Map` 和 `Set` 数据结构，便于后续处理和确保数据的唯一性。

## 📜 API 类型定义

以下是该工具暴露的主要类型定义，用于描述分析结果的结构。

```typescript
// 文件名，即文件的绝对路径
type FileName = string;

// 导入或导出的符号名称
type SymbolName = string;

/**
 * 单个文件的分析结果
 */
type Result = {
  /**
   * 记录该文件的所有本地导入
   * - Key: 被导入文件的绝对路径 (FileName)
   * - Value: 从该文件导入的符号集合 (Set<SymbolName>)
   *   - 对于 `import * as name`, 符号为 '*'
   *   - 对于副作用导入 `import './style.css'`, 符号集合为空
   */
  "import": Map<FileName, Set<SymbolName>>;

  /**
   * 默认导出的符号名称
   * - 'default' 表示匿名的默认导出 (例如 `export default () => {}`)
   * - 符号名称字符串 (例如 `export default MyComponent` 中的 'MyComponent')
   * - `null` 表示没有默认导出
   */
  "defaultExport": string | null, 

  /**
   * 所有命名导出的符号集合
   *   - 包括 `export { name }`
   *   - 包括 `export const name = ...`
   *   - 包括重导出 `export { name } from ...`
   */
  "commonExport": Set<SymbolName>
};

/**
 * 整个分析任务的结果
 * - Key: 被分析文件的绝对路径 (FileName)
 * - Value: 该文件的分析结果 (Result)
 */
type FileAnalysisResult = Map<FileName, Result>;
```

## 🛠️ 支持的导入/导出语法

该工具旨在覆盖 TypeScript 和 React 项目中绝大多数的模块语法。

### 支持的导入方法

1.  **默认导入**: `import React from 'react'`
2.  **命名导入**: `import { Component, useState } from 'react'`
3.  **别名导入**: `import { Component as Comp } from 'react'`
4.  **命名空间导入**: `import * as React from 'react'`
5.  **混合导入**: `import React, { Component } from 'react'`
6.  **副作用导入**: `import './styles.css'`
7.  **类型导入**: `import type { FC } from 'react'`
8.  **内联类型导入**: `import { type FC, useState } from 'react'`
9.  **动态导入**: `const module = await import('./module')`
10. **Require 导入 (CommonJS)**: `const module = require('./module')`

### 支持的导出方法

1.  **默认导出值/标识符**: `export default Component`
2.  **默认导出匿名函数/类**: `export default function() {}`
3.  **默认导出声明**: `export default class Name {}`
4.  **命名导出**: `export { Component, useState }`
5.  **别名导出**: `export { Component as Comp }`
6.  **直接导出声明**: `export const/let/var/function/class ...`
7.  **重导出命名符号**: `export { Component } from './module'`
8.  **全部重导出**: `export * from './module'`
9.  **命名空间重导出**: `export * as utils from './utils'`
10. **类型导出**: `export type { Props }`
11. **接口导出**: `export interface IProps {}`
12. **类型别名导出**: `export type Props = {}`
13. **枚举导出**: `export enum Status {}`