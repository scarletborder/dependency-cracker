import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { InitOptions } from './types';
import { initPathsMapping } from './utils';

// ==================== 类型定义 ====================

type SymbolName = string;
type FileName = string;

interface Result {
    import: Map<FileName, Set<SymbolName>>;
    defaultExport: string | null;
    commonExport: Set<SymbolName>;
    styleImports: Set<FileName>;
}

type FileAnalysisResult = Map<FileName, Result>;

// ==================== 主要服务类 ====================

export class DependencyAnalysisService {
    // 依赖图 - 存储所有文件的导入导出信息
    private depsGraph: FileAnalysisResult = new Map();
    // 已分析的文件集合
    private analyzedFiles: Set<string> = new Set();
    // 路径映射
    private PathsMapping: Map<string, string>;
    // 初始化的目录列表
    private indexDirs: string[] = [];
    // 缓存文件的导出信息
    private exportCache: Map<string, Result> = new Map();

    constructor(options?: InitOptions) {
        if (options?.PathsMappingOptions) {
            this.PathsMapping = initPathsMapping(
                options.PathsMappingOptions.ProjectRoot,
                options.PathsMappingOptions.Paths
            );
        } else {
            this.PathsMapping = new Map();
        }

        if (options?.indexDirs) {
            this.indexDirs = options.indexDirs;
        }
    }

    /**
     * 初始化依赖图 - 分析所有指定目录下的文件
     */
    public async initDepsGraph(): Promise<void> {
        console.log('Initializing dependency graph...');
        const visitedFiles = new Set<string>();

        for (const dir of this.indexDirs) {
            // 查找目录的入口文件 (index.ts/tsx)
            const entryFile = this.findEntryFile(dir);
            if (entryFile) {
                await this.analyzeFileRecursive(entryFile, visitedFiles);
            } else {
                // 如果没有入口文件，分析目录下所有文件
                await this.analyzeDirectory(dir, visitedFiles);
            }
        }

        console.log(`Dependency graph initialized with ${this.depsGraph.size} files`);
    }

    /**
 * 查询文件的所有最终依赖文件
 * @param absFilePath 要查询的文件绝对路径
 * @returns 最终依赖文件的绝对路径数组
 */
    public query(absFilePath: string): string[] {
        const actualPath = this.resolveFilePath(absFilePath);
        if (!actualPath) {
            console.warn(`File not found: ${absFilePath}`);
            return [];
        }

        // 如果文件不在依赖图中，先分析它
        if (!this.depsGraph.has(actualPath)) {
            const visitedFiles = new Set<string>();
            this.analyzeFileRecursive(actualPath, visitedFiles);
        }

        const finalDeps = new Set<string>();
        const visited = new Set<string>();

        // 递归查找所有最终依赖
        this.findAllFinalDependencies(actualPath, finalDeps, visited);

        // 只添加最终依赖文件的样式文件
        const styleDeps = new Set<string>();
        for (const depFile of finalDeps) {
            const fileInfo = this.depsGraph.get(depFile);
            if (fileInfo) {
                fileInfo.styleImports.forEach(styleFile => {
                    styleDeps.add(styleFile);
                });
            }
        }

        // 合并最终依赖文件和样式文件
        styleDeps.forEach(styleFile => finalDeps.add(styleFile));

        return Array.from(finalDeps);
    }


    /**
     * 递归查找所有最终依赖文件
     */
    private findAllFinalDependencies(
        filePath: string,
        finalDeps: Set<string>,
        visited: Set<string>
    ): void {
        // 避免循环依赖
        if (visited.has(filePath)) {
            return;
        }
        visited.add(filePath);

        const fileInfo = this.depsGraph.get(filePath);
        if (!fileInfo) {
            return;
        }

        // 遍历该文件的所有导入
        for (const [importPath, importedSymbols] of fileInfo.import.entries()) {
            // 对每个导入的符号，找到它的真正来源
            for (const symbol of importedSymbols) {
                const symbolSources = this.traceSymbolSource(importPath, symbol, new Set());

                // 添加所有找到的最终依赖
                for (const source of symbolSources) {
                    finalDeps.add(source);
                    // 递归查找这个最终依赖的依赖
                    this.findAllFinalDependencies(source, finalDeps, visited);
                }
            }
        }
    }

    /**
     * 追踪符号的真正来源文件
     * @param filePath 当前文件路径
     * @param symbol 要追踪的符号
     * @param visited 已访问的文件集合（避免循环）
     * @returns 定义该符号的所有源文件路径
     */
    private traceSymbolSource(
        filePath: string,
        symbol: string,
        visited: Set<string>
    ): Set<string> {
        const sources = new Set<string>();

        // 避免循环引用
        if (visited.has(filePath)) {
            return sources;
        }
        visited.add(filePath);

        // 获取文件信息
        const fileInfo = this.depsGraph.get(filePath);
        if (!fileInfo) {
            // 文件不在图中，可能是外部依赖，返回它自己
            sources.add(filePath);
            return sources;
        }

        // 检查符号是否在该文件的导出中
        const isExported = symbol === 'default'
            ? fileInfo.defaultExport !== null
            : fileInfo.commonExport.has(symbol);

        if (!isExported) {
            // 符号不在导出中，可能是内部使用的，返回空
            return sources;
        }

        // 检查该符号是否是从其他文件导入的（重导出的情况）
        let foundInImports = false;
        for (const [importPath, importedSymbols] of fileInfo.import.entries()) {
            if (importedSymbols.has(symbol)) {
                // 这个符号是从其他文件导入的，继续追踪
                foundInImports = true;
                const subSources = this.traceSymbolSource(importPath, symbol, new Set(visited));
                subSources.forEach(s => sources.add(s));
            }
        }

        // 如果符号没有在导入中找到，说明是该文件自己定义的
        if (!foundInImports) {
            sources.add(filePath);
        }

        return sources;
    }

    /**
     * 递归分析文件及其所有依赖
     */
    private analyzeFileRecursive(
        absolutePath: string,
        visitedFiles: Set<string>
    ): void {
        // 检查是否已访问过
        if (visitedFiles.has(absolutePath)) {
            return;
        }
        visitedFiles.add(absolutePath);

        // 解析文件路径
        const actualPath = this.resolveFilePath(absolutePath);
        if (!actualPath) {
            return;
        }

        // 如果已经分析过，从缓存获取
        if (this.depsGraph.has(actualPath)) {
            const result = this.depsGraph.get(actualPath)!;
            // 递归分析依赖
            for (const importPath of result.import.keys()) {
                this.analyzeFileRecursive(importPath, visitedFiles);
            }
            return;
        }

        // 分析文件
        const result = this.analyzeFile(actualPath);
        if (result) {
            this.depsGraph.set(actualPath, result);

            // 递归分析依赖
            for (const importPath of result.import.keys()) {
                this.analyzeFileRecursive(importPath, visitedFiles);
            }
        }
    }

    /**
     * 分析目录下的所有文件
     */
    private async analyzeDirectory(
        dirPath: string,
        visitedFiles: Set<string>
    ): Promise<void> {
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return;
        }

        const files = fs.readdirSync(dirPath);

        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stat = fs.statSync(filePath);

            if (stat.isDirectory()) {
                // 递归处理子目录
                await this.analyzeDirectory(filePath, visitedFiles);
            } else if (stat.isFile() && this.isTypeScriptFile(filePath)) {
                // 分析 TypeScript 文件
                this.analyzeFileRecursive(filePath, visitedFiles);
            }
        }
    }

    /**
     * 分析单个文件
     */
    private analyzeFile(absolutePath: string): Result | null {
        // 读取文件内容
        let sourceCode: string;
        try {
            sourceCode = fs.readFileSync(absolutePath, 'utf-8');
        } catch (err) {
            console.error(`Error reading file ${absolutePath}:`, err);
            return null;
        }

        // 创建源文件 AST
        const sourceFile = ts.createSourceFile(
            absolutePath,
            sourceCode,
            ts.ScriptTarget.Latest,
            true
        );

        // 初始化结果
        const result: Result = {
            import: new Map<FileName, Set<SymbolName>>(),
            defaultExport: null,
            commonExport: new Set<SymbolName>(),
            styleImports: new Set<FileName>()
        };

        // 分析 AST
        this.visitNode(sourceFile, result, absolutePath);

        // 更新缓存
        this.exportCache.set(absolutePath, result);
        this.analyzedFiles.add(absolutePath);

        return result;
    }

    /**
     * 访问 AST 节点
     */
    private visitNode(node: ts.Node, result: Result, currentFilePath: string): void {
        // 处理导入声明
        if (ts.isImportDeclaration(node)) {
            this.handleImportDeclaration(node, result, currentFilePath);
        }
        // 处理导入等号声明
        else if (ts.isImportEqualsDeclaration(node)) {
            this.handleImportEquals(node, result, currentFilePath);
        }
        // 处理动态导入
        else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            this.handleDynamicImport(node, result, currentFilePath);
        }
        // 处理 require
        else if (this.isRequireCall(node)) {
            this.handleRequire(node as ts.CallExpression, result, currentFilePath);
        }
        // 处理导出声明
        else if (ts.isExportDeclaration(node)) {
            this.handleExportDeclaration(node, result, currentFilePath);
        }
        // 处理导出赋值
        else if (ts.isExportAssignment(node)) {
            this.handleExportAssignment(node, result);
        }
        // 处理带导出修饰符的声明
        else if (this.hasExportModifier(node)) {
            this.handleExportedDeclaration(node, result);
        }

        // 递归遍历子节点
        ts.forEachChild(node, child => this.visitNode(child, result, currentFilePath));
    }

    // ==================== 导入处理方法 ====================

    private handleImportDeclaration(
        node: ts.ImportDeclaration,
        result: Result,
        currentFilePath: string
    ): void {
        const moduleSpecifier = node.moduleSpecifier;
        if (!ts.isStringLiteral(moduleSpecifier)) return;

        const importPath = moduleSpecifier.text;

        // 检查是否是样式文件
        if (this.isStyleFile(importPath)) {
            const absoluteStylePath = this.resolveStylePath(currentFilePath, importPath);
            if (absoluteStylePath) {
                result.styleImports.add(absoluteStylePath);
            }
            return; // 样式文件不需要进一步处理符号
        }

        if (!this.isLocalImportPath(importPath)) return;

        const absoluteImportPath = this.resolveImportPath(currentFilePath, importPath);
        const symbols = new Set<SymbolName>();

        if (node.importClause) {
            // 默认导入
            if (node.importClause.name) {
                symbols.add('default');
            }

            // 命名绑定
            if (node.importClause.namedBindings) {
                if (ts.isNamedImports(node.importClause.namedBindings)) {
                    node.importClause.namedBindings.elements.forEach(element => {
                        const symbolName = element.propertyName
                            ? element.propertyName.text
                            : element.name.text;
                        symbols.add(symbolName);
                    });
                } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                    // 命名空间导入 - 获取所有导出
                    const targetExports = this.getFileExports(absoluteImportPath);
                    if (targetExports) {
                        targetExports.commonExport.forEach(s => symbols.add(s));
                        if (targetExports.defaultExport) {
                            symbols.add('default');
                        }
                    }
                }
            }
        }

        if (symbols.size > 0 || !node.importClause) {
            const existing = result.import.get(absoluteImportPath) || new Set();
            symbols.forEach(s => existing.add(s));
            result.import.set(absoluteImportPath, existing);
        }
    }

    private handleImportEquals(
        node: ts.ImportEqualsDeclaration,
        result: Result,
        currentFilePath: string
    ): void {
        if (node.moduleReference && ts.isExternalModuleReference(node.moduleReference)) {
            const expr = node.moduleReference.expression;
            if (expr && ts.isStringLiteral(expr)) {
                const importPath = expr.text;

                // 检查是否是样式文件
                if (this.isStyleFile(importPath)) {
                    const absoluteStylePath = this.resolveStylePath(currentFilePath, importPath);
                    if (absoluteStylePath) {
                        result.styleImports.add(absoluteStylePath);
                    }
                    return;
                }

                if (this.isLocalImportPath(importPath)) {
                    const absoluteImportPath = this.resolveImportPath(currentFilePath, importPath);
                    const targetExports = this.getFileExports(absoluteImportPath);
                    const symbols = new Set<SymbolName>();

                    if (targetExports) {
                        targetExports.commonExport.forEach(s => symbols.add(s));
                        if (targetExports.defaultExport) {
                            symbols.add('default');
                        }
                    }

                    if (symbols.size > 0) {
                        const existing = result.import.get(absoluteImportPath) || new Set();
                        symbols.forEach(s => existing.add(s));
                        result.import.set(absoluteImportPath, existing);
                    }
                }
            }
        }
    }

    private handleDynamicImport(
        node: ts.CallExpression,
        result: Result,
        currentFilePath: string
    ): void {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
            const importPath = arg.text;

            // 检查是否是样式文件
            if (this.isStyleFile(importPath)) {
                const absoluteStylePath = this.resolveStylePath(currentFilePath, importPath);
                if (absoluteStylePath) {
                    result.styleImports.add(absoluteStylePath);
                }
                return;
            }

            if (this.isLocalImportPath(importPath)) {
                const absoluteImportPath = this.resolveImportPath(currentFilePath, importPath);
                const targetExports = this.getFileExports(absoluteImportPath);
                const symbols = new Set<SymbolName>();

                if (targetExports) {
                    targetExports.commonExport.forEach(s => symbols.add(s));
                    if (targetExports.defaultExport) {
                        symbols.add('default');
                    }
                }

                if (symbols.size > 0) {
                    const existing = result.import.get(absoluteImportPath) || new Set();
                    symbols.forEach(s => existing.add(s));
                    result.import.set(absoluteImportPath, existing);
                }
            }
        }
    }

    private handleRequire(
        node: ts.CallExpression,
        result: Result,
        currentFilePath: string
    ): void {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
            const importPath = arg.text;

            // 检查是否是样式文件
            if (this.isStyleFile(importPath)) {
                const absoluteStylePath = this.resolveStylePath(currentFilePath, importPath);
                if (absoluteStylePath) {
                    result.styleImports.add(absoluteStylePath);
                }
                return;
            }

            if (this.isLocalImportPath(importPath)) {
                const absoluteImportPath = this.resolveImportPath(currentFilePath, importPath);
                const targetExports = this.getFileExports(absoluteImportPath);
                const symbols = new Set<SymbolName>();

                if (targetExports) {
                    targetExports.commonExport.forEach(s => symbols.add(s));
                    if (targetExports.defaultExport) {
                        symbols.add('default');
                    }
                }

                if (symbols.size > 0) {
                    const existing = result.import.get(absoluteImportPath) || new Set();
                    symbols.forEach(s => existing.add(s));
                    result.import.set(absoluteImportPath, existing);
                }
            }
        }
    }

    // ==================== 导出处理方法 ====================

    private handleExportDeclaration(
        node: ts.ExportDeclaration,
        result: Result,
        currentFilePath: string
    ): void {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const exportPath = node.moduleSpecifier.text;

            if (this.isLocalImportPath(exportPath)) {
                const absoluteExportPath = this.resolveImportPath(currentFilePath, exportPath);
                const importSymbols = new Set<SymbolName>();
                const exportSymbols = new Set<SymbolName>();

                if (node.exportClause) {
                    if (ts.isNamedExports(node.exportClause)) {
                        node.exportClause.elements.forEach(element => {
                            const originalName = element.propertyName
                                ? element.propertyName.text
                                : element.name.text;
                            const exportName = element.name.text;

                            if (originalName === 'default') {
                                importSymbols.add('default');
                                exportSymbols.add(exportName);
                            } else {
                                importSymbols.add(originalName);
                                exportSymbols.add(exportName);
                            }
                        });
                    } else if (ts.isNamespaceExport(node.exportClause)) {
                        const targetExports = this.getFileExports(absoluteExportPath);
                        if (targetExports) {
                            targetExports.commonExport.forEach(s => importSymbols.add(s));
                            if (targetExports.defaultExport) {
                                importSymbols.add('default');
                            }
                            exportSymbols.add(node.exportClause.name.text);
                        }
                    }
                } else {
                    // export * from
                    const targetExports = this.getFileExports(absoluteExportPath);
                    if (targetExports) {
                        targetExports.commonExport.forEach(s => {
                            importSymbols.add(s);
                            exportSymbols.add(s);
                        });
                    }
                }

                if (importSymbols.size > 0) {
                    const existingImports = result.import.get(absoluteExportPath) || new Set();
                    importSymbols.forEach(s => existingImports.add(s));
                    result.import.set(absoluteExportPath, existingImports);
                }

                exportSymbols.forEach(s => result.commonExport.add(s));
            }
        } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
            node.exportClause.elements.forEach(element => {
                result.commonExport.add(element.name.text);
            });
        }
    }

    private handleExportAssignment(node: ts.ExportAssignment, result: Result): void {
        if (node.isExportEquals) {
            result.defaultExport = 'module.exports';
        } else {
            if (ts.isIdentifier(node.expression)) {
                result.defaultExport = node.expression.text;
            } else if (ts.isFunctionExpression(node.expression) && node.expression.name) {
                result.defaultExport = node.expression.name.text;
            } else if (ts.isClassExpression(node.expression) && node.expression.name) {
                result.defaultExport = node.expression.name.text;
            } else {
                result.defaultExport = 'default';
            }
        }
    }

    private handleExportedDeclaration(node: ts.Node, result: Result): void {
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        const hasDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) || false;
        const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || false;

        if (!hasExport) return;

        if (hasDefault) {
            if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
                result.defaultExport = node.name?.text || 'default';
            }
        } else {
            if (ts.isFunctionDeclaration(node) ||
                ts.isClassDeclaration(node) ||
                ts.isInterfaceDeclaration(node) ||
                ts.isTypeAliasDeclaration(node) ||
                ts.isEnumDeclaration(node) ||
                ts.isModuleDeclaration(node)) {
                if (node.name && ts.isIdentifier(node.name)) {
                    result.commonExport.add(node.name.text);
                }
            } else if (ts.isVariableStatement(node)) {
                node.declarationList.declarations.forEach(decl => {
                    if (ts.isIdentifier(decl.name)) {
                        result.commonExport.add(decl.name.text);
                    } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
                        this.extractBindingNames(decl.name).forEach(name => {
                            result.commonExport.add(name);
                        });
                    }
                });
            }
        }
    }

    // ==================== 辅助方法 ====================

    /**
     * 判断是否是样式文件
     */
    private isStyleFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ['.css', '.scss', '.sass', '.less', '.styl', '.stylus'].includes(ext);
    }

    /**
     * 解析样式文件路径
     */
    private resolveStylePath(fromFile: string, importPath: string): string | null {
        if (this.isRelativeImportPath(importPath)) {
            const dir = path.dirname(fromFile);
            const resolved = path.resolve(dir, importPath);

            // 样式文件通常有明确的扩展名，直接检查文件是否存在
            if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
                return resolved;
            }

            // 如果没有扩展名，尝试添加常见的样式文件扩展名
            if (!path.extname(resolved)) {
                const styleExtensions = ['.css', '.scss', '.sass', '.less', '.styl', '.stylus'];
                for (const ext of styleExtensions) {
                    const pathWithExt = resolved + ext;
                    if (fs.existsSync(pathWithExt) && fs.statSync(pathWithExt).isFile()) {
                        return pathWithExt;
                    }
                }
            }

            return resolved; // 即使文件不存在也返回路径
        } else {
            // 处理路径映射
            const mappedBase = this.PathsMapping.get(importPath);
            if (mappedBase) {
                if (fs.existsSync(mappedBase) && fs.statSync(mappedBase).isFile()) {
                    return mappedBase;
                }
            }
            return null;
        }
    }

    private getFileExports(filePath: string): Result | null {
        // 先检查缓存
        if (this.exportCache.has(filePath)) {
            return this.exportCache.get(filePath)!;
        }

        // 检查依赖图
        if (this.depsGraph.has(filePath)) {
            return this.depsGraph.get(filePath)!;
        }

        // 临时分析文件导出
        const actualPath = this.resolveFilePath(filePath);
        if (!actualPath) return null;

        return this.analyzeFile(actualPath);
    }

    private findEntryFile(dirPath: string): string | null {
        const extensions = ['.ts', '.tsx', '.js', '.jsx'];

        for (const ext of extensions) {
            const indexFile = path.join(dirPath, `index${ext}`);
            if (fs.existsSync(indexFile)) {
                return indexFile;
            }
        }

        return null;
    }

    private isTypeScriptFile(filePath: string): boolean {
        const ext = path.extname(filePath);
        return ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
    }

    private isLocalImportPath(importPath: string): boolean {
        if (this.isRelativeImportPath(importPath)) {
            return true;
        }
        if (this.PathsMapping.get(importPath) != undefined) {
            return true;
        }
        return false;
    }

    private isRelativeImportPath(importPath: string): boolean {
        return importPath.startsWith('./') || importPath.startsWith('../');
    }

    private isRequireCall(node: ts.Node): boolean {
        if (!ts.isCallExpression(node)) return false;
        const expr = node.expression;
        return ts.isIdentifier(expr) && expr.text === 'require' && node.arguments.length > 0;
    }

    private hasExportModifier(node: ts.Node): boolean {
        if (!ts.canHaveModifiers(node)) return false;
        const modifiers = ts.getModifiers(node);
        return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || false;
    }

    private extractBindingNames(pattern: ts.BindingPattern): string[] {
        const names: string[] = [];

        const visitBindingElement = (element: ts.BindingElement) => {
            if (ts.isIdentifier(element.name)) {
                names.push(element.name.text);
            } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
                element.name.elements.forEach(e => {
                    if (ts.isBindingElement(e)) {
                        visitBindingElement(e);
                    }
                });
            }
        };

        pattern.elements.forEach(element => {
            if (ts.isBindingElement(element)) {
                visitBindingElement(element);
            }
        });

        return names;
    }

    private resolveImportPath(fromFile: string, importPath: string): string {
        if (this.isRelativeImportPath(importPath)) {
            const dir = path.dirname(fromFile);
            const resolved = path.resolve(dir, importPath);
            return this.resolveFilePath(resolved) || resolved;
        } else {
            const mappedBase = this.PathsMapping.get(importPath);
            if (mappedBase) {
                return this.resolveFilePath(mappedBase) || mappedBase;
            } else {
                return importPath;
            }
        }
    }

    private resolveFilePath(filePath: string): string | null {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return filePath;
        }

        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

        for (const ext of extensions) {
            const pathWithExt = filePath + ext;
            if (fs.existsSync(pathWithExt)) {
                return pathWithExt;
            }
        }

        for (const ext of extensions) {
            const indexPath = path.join(filePath, `index${ext}`);
            if (fs.existsSync(indexPath)) {
                return indexPath;
            }
        }

        return null;
    }
}

// ==================== 导出 ====================

export default DependencyAnalysisService;