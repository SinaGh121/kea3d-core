package com.kea3d.app

import android.net.Uri
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.InputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private data class FileReadSession(
    val input: InputStream,
    val expectedSize: Long,
    var bytesRead: Long = 0,
  )

  private val fileReader = Executors.newSingleThreadExecutor()
  private val fileSessionLock = Any()
  private val fileGeneration = AtomicLong()
  private var fileSession: FileReadSession? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
      !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)
    ) {
      return
    }

    WebViewCompat.addWebMessageListener(
      webView,
      BRIDGE_NAME,
      setOf("http://tauri.localhost", "https://tauri.localhost"),
    ) { _, message, sourceOrigin, isMainFrame, replyProxy ->
      if (!isMainFrame ||
        sourceOrigin.host != "tauri.localhost" ||
        message.type != WebMessageCompat.TYPE_STRING
      ) {
        return@addWebMessageListener
      }

      val request = runCatching { JSONObject(message.data.orEmpty()) }.getOrElse {
        replyOnUiThread(replyProxy, "error:Invalid native file request.")
        return@addWebMessageListener
      }
      when (request.optString("action")) {
        "open" -> openFile(request, replyProxy)
        "next" -> sendNextChunk(replyProxy)
        "cancel" -> closeFileSession()
        else -> replyOnUiThread(replyProxy, "error:Unsupported native file request.")
      }
    }
  }

  private fun openFile(request: JSONObject, replyProxy: JavaScriptReplyProxy) {
    val uri = runCatching { Uri.parse(request.getString("uri")) }.getOrNull()
    val expectedSize = request.optLong("expectedSize", 0).coerceAtLeast(0)
    if (uri == null || uri.scheme != "content") {
      replyOnUiThread(replyProxy, "error:Only Android content URIs are supported.")
      return
    }

    closeFileSession()
    val generation = fileGeneration.get()
    fileReader.execute {
      try {
        if (generation != fileGeneration.get()) return@execute
        val input = contentResolver.openInputStream(uri)
          ?: throw IllegalStateException("The Android file provider returned no data.")
        synchronized(fileSessionLock) {
          if (generation != fileGeneration.get()) {
            input.close()
            return@execute
          }
          fileSession = FileReadSession(input, expectedSize)
        }
        readAndReply(replyProxy, generation)
      } catch (error: Exception) {
        failFileRead(replyProxy, error, generation)
      }
    }
  }

  private fun sendNextChunk(replyProxy: JavaScriptReplyProxy) {
    val generation = fileGeneration.get()
    fileReader.execute { readAndReply(replyProxy, generation) }
  }

  private fun readAndReply(replyProxy: JavaScriptReplyProxy, generation: Long) {
    try {
      if (generation != fileGeneration.get()) return
      val session = synchronized(fileSessionLock) { fileSession }
        ?: throw IllegalStateException("The native file session is no longer available.")
      val buffer = ByteArray(FILE_CHUNK_SIZE)
      var length = 0
      while (length < buffer.size) {
        if (generation != fileGeneration.get()) return
        val count = session.input.read(buffer, length, buffer.size - length)
        if (count < 0) break
        if (count == 0) continue
        length += count
      }

      if (length == 0) {
        if (session.expectedSize > 0 && session.bytesRead != session.expectedSize) {
          throw IllegalStateException(
            "The Android file provider returned ${session.bytesRead} bytes instead of ${session.expectedSize}.",
          )
        }
        closeFileSession(generation)
        replyOnUiThread(replyProxy, "done", generation)
        return
      }

      session.bytesRead += length
      if (session.expectedSize > 0 && session.bytesRead > session.expectedSize) {
        throw IllegalStateException("The Android file provider returned more data than expected.")
      }
      val chunk = if (length == buffer.size) buffer else buffer.copyOf(length)
      runOnUiThread { if (generation == fileGeneration.get()) replyProxy.postMessage(chunk) }
    } catch (error: Exception) {
      failFileRead(replyProxy, error, generation)
    }
  }

  private fun failFileRead(replyProxy: JavaScriptReplyProxy, error: Exception, generation: Long) {
    closeFileSession(generation)
    val message = error.message.orEmpty().replace(Regex("[\\r\\n]+"), " ").ifBlank {
      "Android could not read this file."
    }
    replyOnUiThread(replyProxy, "error:$message", generation)
  }

  private fun replyOnUiThread(replyProxy: JavaScriptReplyProxy, message: String, generation: Long = fileGeneration.get()) {
    runOnUiThread { if (generation == fileGeneration.get()) replyProxy.postMessage(message) }
  }

  private fun closeFileSession(expectedGeneration: Long? = null) {
    val previous = synchronized(fileSessionLock) {
      if (expectedGeneration != null && expectedGeneration != fileGeneration.get()) return
      if (expectedGeneration == null) fileGeneration.incrementAndGet()
      val previous = fileSession
      fileSession = null
      previous
    }
    runCatching { previous?.input?.close() }
  }

  override fun onDestroy() {
    closeFileSession()
    fileReader.shutdownNow()
    super.onDestroy()
  }

  private companion object {
    const val BRIDGE_NAME = "kea3dNativeFile"
    const val FILE_CHUNK_SIZE = 4 * 1024 * 1024
  }
}
