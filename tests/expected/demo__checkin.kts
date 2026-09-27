@file:Depends("<CANVAS>")

package demo

//@12 28 28
listen<EventType.PlayerChatEvent> {
    val player = it.player
    val message = it.message
//@n bo 28 1
    if (message.<CANVAS>("签到")) {
//@2 l4 28 2
        broadcast("[green]{player.name} 完成了签到".with("player" to player), MsgType.Message, 10f)
    } else {
//@2 l4 8c 2
        player.sendMessage("[yellow]输入『签到』可以签到".with(), MsgType.Message, 10f)
    }
}
