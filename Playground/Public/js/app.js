"use strict";

import { Tooltip } from "bootstrap";
import { Editor } from "./editor.js";
import { Console } from "./console.js";
import { WebSocketClient } from "./websocket.js";
import { clearConsoleButton, formatButton, runButton } from "./ui_control.js";
import { unescapeHTML } from "./unescape.js";
import { uuidv4 } from "./uuid.js";

export class App {
  constructor() {
    this.editor = new Editor(document.getElementById("editor-container"), {
      value: unescapeHTML(`import PowerAssert
import XCTest

final class MyLibraryTests: XCTestCase {
  func testExample() {
    let a = 10
    let b = 9
    #assert(a * b == 91)

    let xs = [1, 2, 3]
    #assert(xs.contains(4))

    #assert("hello".hasPrefix("h") && "goodbye".hasSuffix("y"))

    let d = 4
    let e = 7
    let f = 12
    #assert(max(d, e) == f)
    #assert(d + e > f)
  }
}      
`),
      fontSize: "14pt",
      lineHeight: 21,
      language: "swift",
      wordWrap: "on",
      wrappingIndent: "indent",
      tabSize: 2,
      lightbulb: {
        enabled: true,
      },
      minimap: {
        enabled: false,
      },
      theme: "vs-light",
      showFoldingControls: "mouseover",
    });

    this.terminal = new Console(document.getElementById("terminal-container"));
    this.terminal.writeln(
      `\x1b[37mWelcome to Swift Power Assert Playground.\x1b[0m`
    );
    this.terminal.writeln(
      `\x1b[32mEmpower our project through your generous support on GitHub Sponsors! 💖\x1b[0m`
    );
    this.terminal.writeln(
      `\x1b[32mhttps://github.com/sponsors/kishikawakatsumi/\x1b[0m`
    );

    this.session = uuidv4();

    this.init();
  }

  init() {
    [].slice
      .call(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
      .map((trigger) => {
        return new Tooltip(trigger);
      });

    runButton.classList.remove("disabled");
    clearConsoleButton.classList.remove("disabled");
    formatButton.classList.remove("disabled");

    this.editor.focus();
    this.editor.scrollToBottm();

    const logStream = new WebSocketClient(
      (() => {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const endpoint = `${protocol}//${location.host}/logs/${this.session}`;
        return endpoint;
      })()
    );
    logStream.onresponse = (response) => {
      switch (response.type) {
        case "build":
          this.terminal.eraseLine();
          this.terminal.writeln(`\x1b[2m${response.message}`);
          break;
        case "test":
          this.terminal.eraseLine();
          this.terminal.writeln(`${response.message}`);
          break;
        default:
          break;
      }
    };

    const formatter = new WebSocketClient("wss://swift-format.com/api/ws");
    formatter.onresponse = (response) => {
      if (!response) {
        return;
      }
      if (response.output) {
        this.editor.setValue(response.output);
      }
    };
    formatButton.addEventListener("click", (event) => {
      event.preventDefault();
      formatter.send({ code: this.editor.getValue() });
    });

    runButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.run();
    });

    if (clearConsoleButton) {
      clearConsoleButton.addEventListener("click", (event) => {
        event.preventDefault();
        this.terminal.clear();
      });
    }
  }

  run() {
    if (runButton.classList.contains("disabled")) {
      return;
    }

    runButton.classList.add("disabled");

    document.getElementById("run-button-icon").classList.add("d-none");
    document.getElementById("run-button-spinner").classList.remove("d-none");
    const cancelToken = this.terminal.showSpinner("Running");

    this.editor.clearMarkers();
    this.terminal.hideCursor();

    const params = {
      session: this.session,
      code: this.editor.getValue(),
    };
    const path = `/run`;
    fetch(path, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    })
      .then((response) => {
        this.terminal.hideSpinner(cancelToken);

        if (!response.ok) {
          this.terminal.writeln(
            `\x1b[37m❌  ${response.status} ${response.statusText}\x1b[0m`
          );
        }
        return response.json();
      })
      .then((response) => {
        if (response.stderr) {
          const markers = this.parseErrorMessage(response.stderr);
          this.editor.updateMarkers(markers);
        }
      })
      .catch((error) => {
        this.terminal.hideSpinner(cancelToken);
        this.terminal.writeln(`\x1b[37m❌  ${error}\x1b[0m`);
      })
      .finally(() => {
        runButton.classList.remove("disabled");
        document.getElementById("run-button-icon").classList.remove("d-none");
        document.getElementById("run-button-spinner").classList.add("d-none");

        this.terminal.showCursor();
        this.editor.focus();
      });
  }

  parseErrorMessage(message) {
    const matches = message
      .replace(
        // Remove all ANSI colors/styles from strings
        // https://stackoverflow.com/a/29497680/1733883
        // https://github.com/chalk/ansi-regex/blob/main/index.js#L3
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        ""
      )
      .matchAll(
        /\/test\.swift:(\d+):(\d+): (error|warning|note): ([\s\S]*?)\n*(?=(?:\/|$))/gi
      );
    return [...matches].map((match) => {
      const row = +match[1];
      let column = +match[2];
      const text = match[4];
      const type = match[3];
      let severity;
      switch (type) {
        case "warning":
          severity = 4; // monaco.MarkerSeverity.Warning;
          break;
        case "error":
          severity = 8; // monaco.MarkerSeverity.Error;
          break;
        default: // monaco.MarkerSeverity.Info;
          severity = 2;
          break;
      }

      let length;
      if (text.match(/~+\^~+/)) {
        // ~~~^~~~
        length = text.match(/~+\^~+/)[0].length;
        column -= text.match(/~+\^/)[0].length - 1;
      } else if (text.match(/\^~+/)) {
        // ^~~~
        length = text.match(/\^~+/)[0].length;
      } else if (text.match(/~+\^/)) {
        // ~~~^
        length = text.match(/~+\^/)[0].length;
        column -= length - 1;
      } else if (text.match(/\^/)) {
        // ^
        length = 1;
      }

      return {
        startLineNumber: row,
        startColumn: column,
        endLineNumber: row,
        endColumn: column + length,
        message: text,
        severity: severity,
      };
    });
  }
}