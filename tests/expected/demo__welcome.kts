@file:Depends("<CANVAS>")

package demo

//@14 28 28
listen<EventType.PlayerJoin> {
    val player = it.player
//@2 bo 28 1
    player.sendMessage("欢迎 {player.name} 来到本服务器".with("player" to player), MsgType.Message, 10f)
//@2 bo 6o 1
    broadcast("[cyan][+] {player.name} 加入了服务器".with("player" to player), MsgType.InfoMessage, 10f)
}
