> 如果改动涉及到了导出文件的格式，需要更新packages\core-schema\src\export-version.ts

37. . 导出的时候有时会突发的卡几下，自查下性能问题
全面优化扩展全流程性能问题。
39. 优化网页一键导出服务：
- 指定导出位置
- 控件融入网页原本的元素（可以自己cdp看，或者参考"C:\Users\qpj\project\Workspaces\ctxport"）
- 可选选项导出格式markdown、png、json、html?
- 可选如何处理图片、附件。是否带有thinking块。。。
40. 在适当的时候自动同步磁盘与索引，比如点击清空当前平台本地记录后等。也可以设一个每周一次的时候
该操作很吃性能吗，能否优化，加快速度等

bug:
41. gpt我点击打开来源，跳出的还是带worker标签页