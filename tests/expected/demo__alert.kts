@file:Depends("<CANVAS>")

package demo

//@1x 28 28
loop(Dispatchers.game) {
    delay(30000L)
//@2 bo 3c 1
    broadcast("[yellow]欢迎来到本服务器, 输入 /help 查看指令".with(), MsgType.InfoMessage, 10f)
}
