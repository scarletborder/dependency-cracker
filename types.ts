export interface InitOptions {
  // 待分析的全部文件
  // 对于本任务只需要放置全部的components文件夹,因为我们不关注那些lib的依赖情况
  indexDirs?: string[];

  // 路径映射
  PathsMappingOptions?: {
    ProjectRoot: string;
    Paths: Record<string, string>;
  }
}