@file:Depends("<CANVAS>")

package demo

listen<EventType.PlayerChatEvent> {
    val player = it.player
    val message = it.message
    if (message.<CANVAS>("签到")) {
        broadcast("[green]{player.name} 完成了签到".with("player" to player), MsgType.Message, 10f)
    } else {
        player.sendMessage("[yellow]输入『签到』可以签到".with(), MsgType.Message, 10f)
    }
}


// kts-modular 生成
// 删除后无法恢复
// 锚点（详细，可以完全恢复）
//@kts 1.2.0
//@12 28 28
//@n bo 28 1 | rules=json%3A%5B%7B%22var%22%3A%22message%22%2C%22type%22%3A%22String%22%2C%22field%22%3A%22contains%22%2C%22op%22%3A%22%3D%3D%22%2C%22valueSource%22%3A%22literal%22%2C%22value%22%3A%22%E7%AD%BE%E5%88%B0%22%2C%22arg%22%3A%22%E7%AD%BE%E5%88%B0%22%7D%5D
//@2 l4 28 2 | text=%5Bgreen%5D%7Bplayer.name%7D%20%E5%AE%8C%E6%88%90%E4%BA%86%E7%AD%BE%E5%88%B0
//@2 l4 8c 2 | target=player&text=%5Byellow%5D%E8%BE%93%E5%85%A5%E3%80%8E%E7%AD%BE%E5%88%B0%E3%80%8F%E5%8F%AF%E4%BB%A5%E7%AD%BE%E5%88%B0
