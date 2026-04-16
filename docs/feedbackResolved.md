
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

10. （暂时先不解决了）gemini目前还是不能拉满，我看主要是因为
gemini查历史记录不太稳定，有时会直接罢工报错：“无法加载最近的对话。请尝试重新加载此页面。”
如果发现这种情况需要刷新界面重试
有时会报“无法加载历史记录”，这时候需要降低滑动频率。否则就会罢工报错“无法加载最近的对话。请尝试重新加载此页面。”
gemini我的历史肯定比现在最高水位587还要多，毕竟最早的才2月的，我去年就在用了
然并卵我自己手动拖历史记录也只划到587就报无法加载了，可恶的谷歌
13. markdown格式不够美观，需要优化，要注意要保证我们的格式是多平台统一的
13.1 gemini可以直接参考https://github.com/Nagi-ovo/gemini-voyager 中的导出为markdown的相关代码和逻辑。
13.2 aistudio我没找到网上现成方案，需要你自己优化改进。
我发现的问题：
C:\Users\qpj\OneDrive - MSFT\Downloads\AIexporter\aistudio\求解函数的极值__1yls4T3x\9db78b554d5a\求解函数的极值.md
13.2.1 图片直接嵌入base64了，可以转成图片再嵌入吗
13.2.2 thinking中的一个这样的**Analyzing the Problem**是一段，需要空行分割等
13.2.3 正文回答也是，应该分割清楚。格式化。
17. 这个报错：DeepSeek discovery sidebar was not ready before timeout.
{
  "details": {
    "hrefCount": 0,
    "senderTabId": 1980820454,
    "title": "DeepSeek - 探索未至之境",
    "url": "https://chat.deepseek.com/"
  },
  "id": "c692b20c-341f-4d01-97af-24d77c65ec59",
  "level": "warn",
  "message": "DeepSeek discovery sidebar was not ready before timeout.",
  "scope": "content.deepseek",
  "timestamp": "2026-04-08T10:02:40.237Z"
}
解决一下，如果没有sidebar应该自己尝试打开（你加了这个逻辑吗）
19. 服务一直跑，窗口一直跳，太慢太烦。可以在首次或手动点了才完整更新，否则不要一直更新
仅首次或手动才全量discover，平时看巡检一天一次，且仅在需要时（第一次抓取到的对话记录就都是需要更新的）才滑动历史记录栏
怎么定义是是需要更新的：对话内容有更新，插件版本有更新等
gemini平台风控很严，如果检测到repatcha就不要开窗口了，多等一会
18. 这个扩展有比较严重的性能问题。在网页加载的时候扩展是不是一直在尝试做啥，还是内存问题？每次跑一会导出服务就会卡的整个电脑死机。
性能问题依然存在，你认为应该怎么优化和监控哪里有性能问题？
21. 现在发现对话有更新之后的逻辑是重新导一版新的（包括md和bundle），能否实现只更新增量内容？（如果有冲突则标出并回退）
22. 控制中心的导出日志按钮没用，创建了"C:\Users\qpj\OneDrive - MSFT\Downloads\AIexporter\debug"但里面没东西
23. 深度细化日志阶段，最好覆盖到每一小步。
24. 优化日志架构和展示架构与前端界面（比如同一个sourceId的全过程可以展示在一起）
20. 用户体验还是太差，体现在一直有新窗口跳出来
1. 尝试在有cookie、oauth头的情况下尝试fetch&RPC&api其他方式方式来获取（而不是开新窗口dom，你先cdp测试是否可行）
2. 开最小化的新窗口，再那里做所有扩展服务
3. 开窗口做成后台式、固定式。
25. gemini导出服务不能正常运行，表现为每次开服务的时候，Gemini 会进行全量 discover，discover 完之后，会开一个新页面，但是不会进行导出，而是又开一个新页面进行 discover，然后就不断 discover。
26. AI Studio 服务有时会卡住，表现为一直开着页面，不操作，然后等到日志超时才把它关掉，并继续（而有时是正常的）
27. Dashboard 队列页面，如果队列太多的时候，会特别卡（是不是因为默认全部加载了？可能需要优化）
20. 开新页面默认是固定的（pinned），这样能减少对用户的打扰
28. 平时的自动检测，Discover 服务是多久运行一次？怎么在设置中调？
31. 增加功能，指定导出的文件路径。可以在设置中改动，默认是在下载文件夹中。（另外，需要特别做一下，在设置里改动后的程序逻辑）
32. 同步队列中的已导出记录和实际文件夹路径下的文件（防止出现队列记录中已完成导出，但是实际文件夹中没有文件的情况，或者反之，保持队列文件夹导出的数量和实际文件夹中的数量同步）

29. 我在开 discovering 的时候按 pause，gemini服务卡在 pausing 状态

34. 版本管理（可开关），导出了新版本旧版本移到回收站（默认）。也可设置成有新版本将旧版本移到根下Archive文件夹归档，并且在指定天数后移到回收站（默认7天，可设置）
这样对话文件夹下不要再套一层版本文件夹了
35. 目前已经解决gemini、aistudio对话内嵌图片的问题。
下面解决deepseek平台对话内嵌图片的问题（cdp实测并确定最佳解决方案）
下面解决三个平台对话内嵌各种文档的问题（可以简单点，做成网址引用就行）
用例：
https://chat.deepseek.com/a/chat/s/bce9e936-91e9-45d4-b091-3845f47ed523
https://aistudio.google.com/prompts/1-oV_136h2Kb6co-rSUp00h8qeOvWOr_K
https://gemini.google.com/app/3154b1a718b93ed5
37. ai的thinking过程能否做成默认折叠的，或者你有啥方案
你现在展开的丢失了markdown格式（比如换行）

30. 优化导出文档的格式。首先，默认包含每一句对话的时间（抓取时间戳，并且转成用户友好的时间格式）。然后在 Gemini 平台和以及 AI 796平台中，如果有在对话中有图片的，怎么样优雅的在 Markdown 文档或者是帮斗元数据文档中体现？（base64?，或者是文档的网址，或者是按照文档网址爬下图片，然后存入指定位置，并导入文件位置?）
测试的时候可以使用以下例子
https://gemini.google.com/app/e39d5917d1a7bce7
https://aistudio.google.com/prompts/1DQZsUDyfDZiAN5OF4c4eKs_UdVdBT30Q


33. 本地文件名称优化
- 大标题不应该直接用用户的首句话，应当尽量抓取网站上现有的对话主题（你可以cdp看一轮怎么获取）（主要是gemni平台有这个问题）

36. 有个特别长的对话导出转md转到后面好像格式有问题，markdown格式丢了
C:\Users\qpj\Documents\Obsidian Vault\AIexporter\aistudio\Copy of 2qqqqCopy of 111 v2 SDG 优先排序项目指南__1jt9rWWA\5e42e002e1e3\Copy of 2qqqqCopy of 111 v2 SDG 优先排序项目指南.md（这个也可以做测试例，里面包含了各种长文本、文档、图片等）