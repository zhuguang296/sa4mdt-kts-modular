@file:Depends("<CANVAS>")

package demo

//@d 28 28
<CANVAS>("hello", "打个招呼") {
    aliases = listOf("你好")
    attr(ClientOnly)
    requirePermission("demo.hello")
    body {
//@2 c8 3w 2
        player!!.sendMessage("[green]你好 {player.name}".with("player" to player!!), MsgType.Message, 10f)
    }
}
