@file:Depends("<CANVAS>")

package demo

<CANVAS>("hello", "打个招呼") {
    aliases = listOf("你好")
    attr(ClientOnly)
    requirePermission("demo.hello")
    body {
        player!!.sendMessage("[green]你好 {player.name}".with("player" to player!!), MsgType.Message, 10f)
    }
}


// kts-modular 生成
// 删除后无法恢复
// 锚点（详细，可以完全恢复）
//@kts 1.2.0
//@d 28 28 | aliases=%E4%BD%A0%E5%A5%BD&permission=demo.hello
//@2 c8 3w 2 | target=player&text=%5Bgreen%5D%E4%BD%A0%E5%A5%BD%20%7Bplayer.name%7D
