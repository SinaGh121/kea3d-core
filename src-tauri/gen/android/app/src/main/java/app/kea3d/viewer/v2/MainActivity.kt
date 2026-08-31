package app.kea3d.viewer.v2

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
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private data class FileReadSession(
    val input: InputStream,
    val expectedSize: Long,
    var bytesRead: Long = 0,
  )

  private val fileReader = Executors.newSingleThreadExecutor()
  private val fileSessionLock = Any()
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

    fileReader.execute {
      try {
        val input = contentResolver.openInputStream(uri)
          ?: throw IllegalStateException("The Android file provider returned no data.")
        synchronized(fileSessionLock) {
          fileSession?.input?.close()
          fileSession = FileReadSession(input, expectedSize)
        }
        readAndReply(replyProxy)
      } catch (error: Exception) {
        failFileRead(replyProxy, error)
      }
    }
  }

  private fun sendNextChunk(replyProxy: JavaScriptReplyProxy) {
    fileReader.execute { readAndReply(replyProxy) }
  }

  private fun readAndReply(replyProxy: JavaScriptReplyProxy) {
    try {
      val session = synchronized(fileSessionLock) { fileSession }
        ?: throw IllegalStateException("The native file session is no longer available.")
      val buffer = ByteArray(FILE_CHUNK_SIZE)
      var length = 0
      while (length < buffer.size) {
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
        closeFileSession()
        replyOnUiThread(replyProxy, "done")
        return
      }

      session.bytesRead += length
      if (session.expectedSize > 0 && session.bytesRead > session.expectedSize) {
        throw IllegalStateException("The Android file provider returned more data than expected.")
      }
      val chunk = if (length == buffer.size) buffer else buffer.copyOf(length)
      runOnUiThread { replyProxy.postMessage(chunk) }
    } catch (error: Exception) {
      failFileRead(replyProxy, error)
    }
  }

  private fun failFileRead(replyProxy: JavaScriptReplyProxy, error: Exception) {
    closeFileSession()
    val message = error.message.orEmpty().replace(Regex("[\\r\\n]+"), " ").ifBlank {
      "Android could not read this file."
    }
    replyOnUiThread(replyProxy, "error:$message")
  }

  private fun replyOnUiThread(replyProxy: JavaScriptReplyProxy, message: String) {
    runOnUiThread { replyProxy.postMessage(message) }
  }

  private fun closeFileSession() {
    synchronized(fileSessionLock) {
      runCatching { fileSession?.input?.close() }
      fileSession = null
    }
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
