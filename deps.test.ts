import { expect, test } from "vitest";
import { DependencyAnalysisService } from "./service";
const RootPath = "../../..";

import fs from 'fs';
import path from 'path';

test('TestComponentPackages 文件夹数量应大于10', () => {
  const dir = path.resolve(__dirname, RootPath, 'testing/PagedooBase/src');
  console.log('Directory path:', dir);
  const items = fs.readdirSync(dir, { withFileTypes: true });
  const folders = items.filter(item => item.isDirectory());
  expect(folders.length).toBeGreaterThan(10);
});

// test("Video组件的依赖文件必须是", async () => {
//   const dir = path.resolve(__dirname, RootPath, 'testing/PagedooBase/src/Video');
//   console.log('Directory path:', dir);

//   const results = analyzeTypeScriptFile(path.resolve(dir, 'index.tsx'));

//   results.forEach((result, fileName) => {
//     console.log(`\n=== File: ${fileName} ===`);

//     console.log('\nImports:');
//     result.import.forEach((symbols, importPath) => {
//       console.log(`  ${importPath}: [${Array.from(symbols).join(', ')}]`);
//     });

//     console.log('\nExports:');
//     console.log(`  Default: ${result.defaultExport || 'none'}`);
//     console.log(`  Named: [${Array.from(result.commonExport).join(', ')}]`);
//   });
// })

test("某个gems组件的全部dep", async () => {
  const dir = path.resolve(__dirname, RootPath, 'testing/packages/gems-materials-pagedoo-base/src/components/Audio');
  console.log('Directory path:', dir);

  const targetFilePath = path.resolve(dir, 'index.tsx');
  const analyzer = new DependencyAnalysisService({
    PathsMappingOptions: {
      ProjectRoot: path.resolve(__dirname, RootPath, 'testing/packages'),
      Paths: {
        "@tencent/pagedoobase": "PagedooBase/src",
        "@tencent/pagedoohooks": "PagedooHooks/src",
        "@tencent/pagedoo-formily": "PagedooFormily/src",
        "@tencent/pagedooactivity": "PagedooActivity/src",
      }
    },
    indexDirs: ["/Users/songrujia/codes/sf-lang-analysis/testing/packages/gems-materials-pagedoo-base/src/components"]
  });

  await analyzer.initDepsGraph();
  const res = analyzer.query(`/Users/songrujia/codes/sf-lang-analysis/testing/packages/gems-materials-pagedoo-base/src/components/Audio/index.tsx`);
  console.log('Analysis Result:', res);
})