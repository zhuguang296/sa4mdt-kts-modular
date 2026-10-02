@file:Depends("<CANVAS>")

package demo

loop(Dispatchers.game) {
    delay(30000L)
    broadcast("[yellow]欢迎来到本服务器, 输入 /help 查看指令".with(), MsgType.InfoMessage, 10f)
}


// kts-modular 生成
// 删除后无法恢复
// 锚点（详细，可以完全恢复）
//@kts 1.2.0
//@1x 28 28
//@2 bo 3c 1 | text=%5Byellow%5D%E6%AC%A2%E8%BF%8E%E6%9D%A5%E5%88%B0%E6%9C%AC%E6%9C%8D%E5%8A%A1%E5%99%A8%2C%20%E8%BE%93%E5%85%A5%20%2Fhelp%20%E6%9F%A5%E7%9C%8B%E6%8C%87%E4%BB%A4&msgType=MsgType.InfoMessage
