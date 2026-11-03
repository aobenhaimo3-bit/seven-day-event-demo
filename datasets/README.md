# Project 3 原始数据

`project3/` 保存课程 Project 3 地缘政治新闻标注原始数据包中的三个核心文件，按原字节复制，用于准备新闻案例输入和检查数据处理流程。

新闻记录的 `publisher`、`url` 字段保留原包中的来源信息。原始数据包未附明示再分发许可证，本仓库没有为这些数据另行授予许可证；新闻及第三方数据的权利归其各自权利人。

## 文件、字段与规模

| 文件 | 记录数 | 字节数 | 内容 |
| --- | ---: | ---: | --- |
| `project3/cases.json` | 30 | 8,415 | 案例ID、研究对象、研究局势及历史日期窗口 |
| `project3/news.jsonl` | 11,343 | 45,273,557 | 以`news_id`索引的新闻全文与共享元数据 |
| `project3/case_news.jsonl` | 13,105 | 4,254,721 | 案例—新闻关联及该关联的标题、日期、来源 |

总计49,536,693字节，约49.5 MB（十进制）。

- `cases.json` 是JSON数组，字段为`case_id`、`countries_regions`、`target_situation`、`news_start`、`news_end`。
- `news.jsonl` 每行一条记录，字段为`news_id`、`title`、`text`、`date`、`publisher`、`url`、`captured_at`。
- `case_news.jsonl` 每行一条关联，字段为`case_id`、`news_id`、`title`、`date`、`captured_at`、`publisher`、`url`。同一新闻可关联多个研究案例，因此关联数大于新闻数。
- 原包本轮任务是对案例—新闻相关性填写`yes/no`，原标签待填写。本目录三个核心原始文件没有已完成的相关性标签、CAMEO类别或未来七天独立事件真值，也没有老师预先划定的训练、验证、测试集合。仓库使用的集合划分来自本项目的研究流程。

## 原字节 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `project3/cases.json` | `0838750c783bfb073001712f318e7ae81dc8445abc85fc558335c6bb910bab90` |
| `project3/news.jsonl` | `b3bfd1c17dd9ddede69d929c4d4bb12a7758cd2c83df21a7f280c28a2a9710a9` |
| `project3/case_news.jsonl` | `9a6fa4249fb6ae69f3ffcc2cdf881b36c3fe7ff286f4db31c5f7facf550d44bd` |

`.gitattributes` 对这三个文件禁用文本换行转换，以保留这些原字节哈希。

## 准备 Demo 输入

在仓库根目录运行：

```sh
node scripts/prepare-input.mjs
node server.mjs
```

准备脚本只读取上述三个源文件，默认将 **S021–S030** 合并为`case{news}`格式的10个无标签案例，共3,670条案例—新闻关联，写入被Git忽略的`local-data/test_input.jsonl`。这里的“测试案例”是本项目固定划分的输入，不是独立真实冲突真值；生成输入不会训练模型或访问测试答案。

可用`node scripts/prepare-input.mjs --all`准备全部30例，或`node scripts/prepare-input.mjs --case S021`只准备一个案例。`--all`保留本项目的15个训练、5个验证、10个测试案例的展示标记，仅用于回放和预览，不因此重新拟合模型。

脚本按`news_id`取得正文，以`case_news.jsonl`的关联标题、日期和媒体元数据覆盖共享记录，检查ID引用、重复关联、有效日历日期和案例历史窗口。它不会将超出案例窗口的日期静默截断。新闻日期仍是报道日期，不自动等于实际事件发生日期。
