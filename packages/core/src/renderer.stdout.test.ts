import { EventEmitter } from "events"
import { expect, test } from "bun:test"

import { capture } from "./console"
import { createTestRenderer } from "./testing/test-renderer"

type MockStdout = NodeJS.WriteStream & { written: string[] }

function createMockStdout(): MockStdout {
  const emitter = new EventEmitter() as MockStdout
  emitter.columns = 120
  emitter.rows = 40
  emitter.isTTY = true
  emitter.writable = true
  emitter.writableLength = 0
  emitter.written = []
  emitter.write = function (chunk: any) {
    emitter.written.push(chunk.toString())
    return true
  }
  emitter.cork = () => {}
  emitter.uncork = () => {}
  emitter.setDefaultEncoding = () => emitter
  emitter.end = () => emitter
  emitter.destroySoon = () => emitter
  emitter.clearLine = () => true
  emitter.cursorTo = () => true
  emitter.moveCursor = () => true
  emitter.getColorDepth = () => 24
  emitter.hasColors = () => true
  emitter.getWindowSize = () => [emitter.columns, emitter.rows]
  emitter.ref = () => emitter
  emitter.unref = () => emitter
  return emitter
}

test("javascript mode keeps stdout interception active and capture records writes", async () => {
  const mockStdout = createMockStdout()
  const originalWrite = mockStdout.write

  const { renderer } = await createTestRenderer({
    outputMode: "javascript",
    stdout: mockStdout,
    disableStdoutInterception: false,
  })

  try {
    expect(mockStdout.write).not.toBe(originalWrite)

    capture.claimOutput()
    mockStdout.write("external log\n")
    expect(capture.claimOutput()).toBe("external log\n")

    ;(renderer as any).writeOut("frame bytes\n")
    expect(mockStdout.written).toContain("frame bytes\n")
  } finally {
    renderer.destroy()
  }
})
