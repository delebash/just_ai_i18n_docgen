<script setup>
// The server didn't answer at start-up: the kit's connection-error screen, on its own route outside
// the layout (boot/docgen.js sends every route here while the server is down). The renderer has no
// data of its own, so nothing else loads without the server; Retry reloads the window, and the boot
// then returns to the page the user was on (the route's `from`).
import { ConnectionError, serverUrl } from "@delebash/llm-ui";
</script>

<template>
  <ConnectionError
    app-name="Just AI i18n & DocGen"
    :server-url="serverUrl('')"
    need="read your locale files and run translations"
    dev-hint="Dev: it should start automatically with `npm run dev`, or run it yourself with `npm run server`, then retry."
  />
</template>
