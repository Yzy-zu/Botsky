ARG EVOLUTION_BASE_IMAGE
FROM ${EVOLUTION_BASE_IMAGE}

COPY src/utils/whatsappText.js /evolution/botsky/src/utils/whatsappText.js
COPY src/integrations/evolutionNativeTables.js /evolution/botsky/src/integrations/evolutionNativeTables.js
COPY scripts/patch-evolution-native-tables.cjs /evolution/botsky/scripts/patch-evolution-native-tables.cjs
RUN node /evolution/botsky/scripts/patch-evolution-native-tables.cjs /evolution/dist/main.js
