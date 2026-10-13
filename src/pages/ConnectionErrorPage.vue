<script setup>
// The server didn't answer at start-up: the kit's connection-error screen, on its own route outside
// the layout (boot/docgen.js sends every route here while the server is down). The renderer has no
// data of its own, so nothing else loads without the server; Retry reloads the window, and the boot
// then returns to the page the user was on (the route's `from`).
import { ConnectionError, serverUrl } from "@delebash/llm-ui";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <ConnectionError
    :app-name="t('app.name')"
    :server-url="serverUrl('')"
    :need="t('connectionError.need')"
    :dev-hint="t('connectionError.devHint')"
  />
</template>
