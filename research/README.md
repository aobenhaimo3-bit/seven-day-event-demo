# 训练复现资料

本目录保存当前实验实际使用的辅助标注和研究对象别名，供检查、修改和重训使用。

- `annotations.jsonl`：150 篇训练新闻的 GPT/Codex 事件试标，共 237 条事件候选。全部属于 S001–S015，`pair_id` 与准备脚本生成的训练组合对应。
- `case_aliases.json`：30 个案例的公开主体、地区与范围关键词。它来自研究对象定义，不包含未来事件答案。

试标相关性分布为 117 个 `yes`、31 个 `no`、2 个 `uncertain`；其中 73 篇标记为 `review_required`。记录保留事件状态、断言、日期精度、范围、原文证据和复核备注，`pilot_status` 均为 `trial_not_gold`。这些是待复核的银标，不是教师确认的标准答案，也不是测试集的未来事件真值。

标注步骤使用已保存的试标记录复现，无需调用 GPT API。老师可对照 `datasets/project3/` 的新闻，按 `pair_id` 逐条审阅；若修改标注，请重新运行开发数据准备和训练，再检查验证结果。测试输入不参与标注训练或参数选择。

原字节 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `annotations.jsonl` | `50a9e4cd83c81c3977a4a301fafc4a6c3be009f66dfd07e9c1742bbea5a994a0` |
| `case_aliases.json` | `271b219e1ba58b5395edaadd81fb67aadfac0eda144c41f41cfe048d2d351e70` |

标注中的原文摘录来自随仓库提供的新闻。新闻和第三方数据的权利说明见 [数据说明](../datasets/README.md)。
