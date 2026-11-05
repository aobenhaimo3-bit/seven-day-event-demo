# GPT-6 Astra 标注参考资料 v1

这份资料公开本项目实际使用的 **220 条 GPT-6 Astra 模型辅助标注**，包括原固定 60 条审核记录及补样 v3 的 160 条案例—新闻组合。它们是模型银标，人工复核完成数为 **0**。模型名称、实际完成时间、代理标识、证据、不确定项和原始意见均原样保留。

先下载 [Excel 审核表](Astra-model-annotations.xlsx) 查看标签与证据，或下载 [标签阅读页](reference.html) 后在浏览器打开。GitHub 的 HTML 文件预览显示源码，不会直接运行筛选界面。

| 文件 | 内容 |
| --- | --- |
| [annotations.jsonl](annotations.jsonl) | 220 条原始初审标签、短原文证据、说明、模型身份和完成时间 |
| [secondary-annotations.jsonl](secondary-annotations.jsonl) | 20 条同模型第二轮盲审原始意见 |
| [sources.json](sources.json) | 案例范围、标题、媒体、日期、原 URL、新闻 ID 和原文哈希 |
| [annotation-report.json](annotation-report.json) | 标注阶段的汇总和校验结果 |
| [review-queue.json](review-queue.json) | 37 条模型不确定、质量标记或两轮分歧的复核记录 |
| [recognition-cohort.json](recognition-cohort.json) | 后续识别比较固定纳入的 179 条及排除原因 |
| [manifest.json](manifest.json) | 公开文件的字节数、SHA-256 和原标注版本标识 |

五项标签为 `relevance`（相关性）、`action`（军事行动）、`threat`（军事威胁）、`posture`（军事姿态）、`cooperation`（协商合作）。`true` / `false` 分别表示模型判断“是”／“否”，`null` 表示不确定，不能转成负例。状态 `model_annotated` 表示五项均确定，`model_uncertain` 表示至少一项不确定。`confidence` 只是模型自评把握，没有经过概率校准。完整定义与时间口径见 [原标注协议](../astra-annotation-protocol.md)。

共有 31 条记录包含不确定项，合计 39 个标签为 `null`。第二轮盲审的 20 条中，14 条五项完全一致，6 条有分歧；这属于同模型抽查，不是人工一致性或独立真值。37 条模型复核记录之外，还有 [4 条旧来源／范围隔离记录](../data-quality-findings.json)。后续识别比较整条排除这 41 条，固定使用 179 条，未将排除项算作负例，也没有改写原始标注。

来源索引不附新闻全文，保留短证据及来源链接。固定 60 条的输入没有原始 URL，可按 `news.news_id` 在仓库的 [原始新闻数据](../../datasets/project3/news.jsonl) 查阅；其余来源按 `news.url` 查看。网页当前内容可能与采集版本不同。Excel 是原标注阶段工作簿的原字节副本，其中“全文见配套阅读页”指原本地完整阅读页；本公开包的阅读页展示标签、短证据和来源索引。

`source_sha256` 校验的是当时完整案例与新闻输入 JSON（包含全文），不是公开的简化来源索引；`news.text_sha256` 校验原始完整新闻正文。公开包的逐文件哈希见 manifest。导出时已用保留的本地全文检查源文哈希及证据逐字匹配，但仅凭公开元数据不能重新进行完整原文核验。新闻及其摘录的权利归原来源；本项目未提供新的第三方内容授权。

这批标签已经用于本项目开发和错误分析，不能称为未触碰的独立测试或人工金标准，也没有自动并入预测模型的训练数据。原 `annotation-report.json` 保留标注阶段的事实与校验声明；后续 v8 重训结果另见 [识别与预测报告](../astra-recall-v8.json)。

下载仓库后，可离线校验本参考包的文件完整性、数量、身份声明及未决状态：

```sh
node scripts/verify-reference-annotations.mjs
```

维护者导出同一版本使用 `node scripts/publish-reference-annotations.mjs`，它要求原本地标注归档和工作簿存在，并先校验原文、来源及冻结标注。脚本拒绝静默覆盖已发生变化的 v1 文件；更新判断或原文时应发布新版本并保留旧意见。
