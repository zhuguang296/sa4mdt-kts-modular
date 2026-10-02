@file:Depends("<CANVAS>")

package demo

listen<EventType.PlayerJoin> {
    val player = it.player
    player.sendMessage("欢迎 {player.name} 来到本服务器".with("player" to player), MsgType.Message, 10f)
    broadcast("[cyan][+] {player.name} 加入了服务器".with("player" to player), MsgType.InfoMessage, 10f)
}


// kts-modular 生成
// 删除后无法恢复
// 锚点（详细，可以完全恢复）
//@kts 1.2.0
//@14 28 28
//@2 bo 28 1 | target=player&text=%E6%AC%A2%E8%BF%8E%20%7Bplayer.name%7D%20%E6%9D%A5%E5%88%B0%E6%9C%AC%E6%9C%8D%E5%8A%A1%E5%99%A8
//@2 bo 6o 1 | text=%5Bcyan%5D%5B%2B%5D%20%7Bplayer.name%7D%20%E5%8A%A0%E5%85%A5%E4%BA%86%E6%9C%8D%E5%8A%A1%E5%99%A8&msgType=MsgType.InfoMessage
