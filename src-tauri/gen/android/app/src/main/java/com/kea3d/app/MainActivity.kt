package com.kea3d.app

import android.net.Uri
import android.app.Activity
import android.content.Intent
import android.provider.DocumentsContract
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
import org.json.JSONArray

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
  private var folderReply: JavaScriptReplyProxy? = null
  private var folderPaths = emptyList<String>()

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
      webView, "kea3dProjectFolder", setOf("http://tauri.localhost", "https://tauri.localhost"),
    ) { _, message, sourceOrigin, isMainFrame, reply ->
      if (!isMainFrame || sourceOrigin.host != "tauri.localhost" || message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
      try {
        check(folderReply == null) { "A folder request is already open." }
        val paths = JSONObject(message.data.orEmpty()).getJSONArray("paths")
        require(paths.length() in 1..1024)
        val validated = (0 until paths.length()).map { paths.getString(it) }
        require(validated.all { path -> path.length <= 1024 && path.split('/').size <= 32 && !path.contains('\\') && !path.contains(':') && !path.contains('%') && path.split('/').all { it.isNotBlank() && it != "." && it != ".." && it.none { c -> c.code < 32 } } })
        folderPaths = validated
        folderReply = reply
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), 7461)
      } catch (error: Exception) {
        if (folderReply === reply) folderReply = null
        reply.postMessage(JSONObject().put("error", error.message ?: "Folder access could not be requested.").toString())
      }
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

  @Deprecated("Android activity result compatibility hook")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != 7461) return
    val reply = folderReply ?: return
    val paths = folderPaths
    val tree = data?.data
    if (resultCode != Activity.RESULT_OK || tree == null) {
      folderReply = null
      reply.postMessage(JSONObject().put("cancelled", true).toString())
      return
    }
    fileReader.execute {
      val result = try {
        val files = JSONArray()
        var totalEntries = 0
        for (path in paths) {
          var parent = DocumentsContract.getTreeDocumentId(tree)
          var found: JSONObject? = null
          for ((index, segment) in path.split('/').withIndex()) {
            val children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent)
            var match: JSONObject? = null
            val projection = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE)
            val cursor = contentResolver.query(children, projection, null, null, null)
              ?: throw IllegalStateException("The provider could not read the selected folder.")
            cursor.use {
              var count = 0
              while (it.moveToNext()) {
                check(++count <= 20000) { "The selected folder has too many entries." }
                check(++totalEntries <= 100000) { "Folder lookup exceeded its safe entry limit. Select resource files individually." }
                if (it.getString(1) == segment) {
                  check(match == null) { "The selected folder contains duplicate resource names." }
                  match = JSONObject().put("id", it.getString(0)).put("type", it.getString(2)).put("size", if (it.isNull(3)) -1 else it.getLong(3))
                }
              }
            }
            val item = match ?: break
            val last = index == path.split('/').lastIndex
            if (!last) {
              check(item.getString("type") == DocumentsContract.Document.MIME_TYPE_DIR) { "A resource directory is not a folder." }
              parent = item.getString("id")
            } else {
              check(item.getString("type") != DocumentsContract.Document.MIME_TYPE_DIR) { "A resource file is a folder." }
              found = JSONObject().put("path", path).put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, item.getString("id")).toString()).put("size", item.getLong("size"))
            }
          }
          if (found != null) files.put(found)
        }
        JSONObject().put("files", files)
      } catch (error: Exception) {
        JSONObject().put("error", if (error is SecurityException) "Folder access was denied. Choose the project folder and allow access." else error.message ?: "The folder provider could not be read.")
      }
      runOnUiThread {
        folderReply = null
        reply.postMessage(result.toString())
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
