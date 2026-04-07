1. gemini测试的时候卡住了
Worker start skipped because busy worker limit was reached.
{
  "details": {
    "busyWorkers": 1,
    "platform": "gemini",
    "queue": {
      "cancelled": 0,
      "completed": 106,
      "failed": 2,
      "pending": 661,
      "processing": 1,
      "skipped": 3,
      "total": 773
    },
    "targetWorkers": 1
  },
  "id": "c67f8110-faaa-440b-998e-7c7daa668e11",
  "level": "debug",
  "message": "Worker start skipped because busy worker limit was reached.",
  "scope": "background.queue",
  "timestamp": "2026-04-07T14:48:40.576Z"
}
2. ds和ai studio一直在starting和更新队列尝试导出，但显示已完成世纪尝试次数零，且只创建了文件夹，没有生成任何文件。
好像经常判定成exist？应该主动探测目标文件夹内是否有文件
经常一路info通顺但没实际生成文件
{
  "details": {
    "files": [
      "C:\\Users\\qpj\\OneDrive - MSFT\\Downloads\\AIexporter\\aistudio\\极化电荷产生的电场__1eiIuJ9A\\9340cbf7cd62\\极化电荷产生的电场.md",
      "C:\\Users\\qpj\\OneDrive - MSFT\\Downloads\\AIexporter\\aistudio\\极化电荷产生的电场__1eiIuJ9A\\9340cbf7cd62\\极化电荷产生的电场.bundle.json"
    ],
    "key": "aistudio:1eiIuJ9ABN_ZcH1dJbX88RU1dOcNJtt8t:c83781f323f4d8b2a0011009dfeef1d709f7df89495e1b8da6f889c16d571b73",
    "platform": "aistudio",
    "revision": "9340cbf7cd62ecbc62822ccdd4854e5d64f5ffcc5776bc8994b840ac443fe153",
    "workerId": "84bdca1c-d464-433a-9607-c3b0e4ee8634"
  },
  "id": "5fb63cbc-2be1-4e8c-b184-3863ad3d3e7c",
  "level": "info",
  "message": "Worker completed queue item.",
  "scope": "background.queue",
  "timestamp": "2026-04-07T14:52:52.017Z"
}
22:52:55 INFO content.aistudio - AI Studio content script initialized.
22:52:52 INFO background.queue - Starting worker for queue item.
22:52:52 INFO background.queue - Starting worker for queue item.
22:52:52 INFO background.queue - Worker completed queue item.
22:52:52 INFO background.queue - Worker completed queue item.
22:52:51 INFO background.persist - Persisting conversation bundle.
22:52:50 INFO background.persist - Persisting conversation bundle.
3. 跑了一段时间也卡死了，详见日志
4. 你之后自己测试能否多跑跑长线的测试，比如先清空他们的导出数据和文件，完整的让四个平台从头开始从discovering到第一轮全量starting，你等个几十分钟，然后看日志看成果。来发现用户使用的问题
5. gemini和ai studio还是没有discover到全部对话历史，我查到aistudio最老的是5 months ago，我应该最早就在用了
6. gemini网站时间: N/A，正常吗。确定找不到任何时间数据吗