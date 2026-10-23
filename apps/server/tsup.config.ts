import { defineConfig } from 'tsup'
import core from '../../packages/core/package.json'
export default defineConfig({entry:{index:'src/index.ts','transcription-worker':'src/transcription-worker.ts','embedding-worker':'src/embedding-worker.ts','calendar-worker':'src/calendar-worker.ts'},format:['cjs'],target:'node24',platform:'node',clean:true,splitting:false,noExternal:[/^@hidock\/core/],external:Object.keys(core.dependencies)})
