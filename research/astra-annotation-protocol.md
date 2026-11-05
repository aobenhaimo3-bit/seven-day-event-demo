# GPT-6 Astra 模型辅助标注 v1

执行范围：固定识别审阅集 60 条 + 补样 v3 的 160 条，共 220 条案例—新闻组合。此批是模型辅助银标，不是人工标注、人工裁决或独立事件真值。原 review.jsonl、补样快照、人工审核工作簿与模型均保持原样。

采用 research/evaluation-protocol.md 的五项定义和发表日前七天时效口径，针对每条记录给出的主体关系及地区范围阅读全文。初审不读取分类器输出、已有筛查结论或其他审核者标签。

- relevance：实质涉及指定主体关系或明确地区的政治/军事/安全情境；仅地名、名单、历史类比、文化体育及无关战区不充分。
- action：范围内、当期已实施/正在实施的常规军事行动报道。计划、武器能力、部署、演习、假设、纯否认或无法确认的争议说法不算。
- threat：已实际发出的范围内军事威胁；与未来被威胁行动本身区分。
- posture：已实施/正在实施的部署、动员或演习，只有计划不算。
- cooperation：已经举行/正在进行的会谈、协商；明确意向及第三方建议不算已发生。

relevance=false 时其余四项必须 false。不确定不能强制写成 false：标签允许 null，并列明原因。相对时间以该条新闻发表日为参照；超过七天为历史，未来日期不算当期。发生日期与发表日期分开，无确切日期则 event_date=null。正文当前断言可按报道评价，不声称独立核实事实。否认责任与否认事件发生须分别阅读。避免从图片说明、推荐新闻标题、旧背景中提取当前事件。

每篇必须由指定的 gpt-6-astra 代理完整阅读后生成判断，不能运行现有检测器、复制程序预测或用关键词规则填标签。脚本只负责分片、序列化、校验和汇总。保留 reviewer_type=model、model_id、代理标识、实际完成时间、输入哈希、五项标签、简短中文判断依据和逐字证据。至少一条原文证据支持主题判断，每项正事件标签必须有对应证据；尽量使用短引句，总计不超过 25 个英文词/记录。没有证据时不得编造。

状态：五项均确定为 model_annotated；任一 null 为 model_uncertain。模型初审并不保证正确。人工复核字段留空，不使用 human-reviewed、adjudicated 或人工审核人身份。可以另行报告与分类器的银标一致性，但不得作为人工金标准准确率，不自动合并训练。

输出单条结构（示意值不可照抄为真实判断）：

```json
{
  "schema_version": 1,
  "pair_id": "输入中的精确ID",
  "source_sha256": "输入中的精确哈希",
  "reviewer_type": "model",
  "model_id": "gpt-6-astra",
  "agent_id": "实际代理路径",
  "completed_at": "实际ISO时间",
  "review_status": "model_annotated",
  "labels": {"relevance": false, "action": false, "threat": false, "posture": false, "cooperation": false},
  "confidence": "high",
  "evidence": [{"fields":["relevance"],"quote":"原文短引句","actor":null,"target":null,"event_date":null,"temporal_basis":"不适用","assertion":"not_applicable"}],
  "notes": "简短中文结论依据，说明相关性、正事件及主要排除理由，不输出推理链。",
  "uncertainties": [],
  "quality_flags": []
}
```
