import type { Reporter, ReporterStreams, ReporterOptions } from "./reporter.js";
import type { EventEnvelope } from "./events.js";
import { renderVerboseEvent } from "./verbose-formatter.js";

export class JsonlReporter implements Reporter {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly verbose: boolean;

  constructor(streams: ReporterStreams, options?: ReporterOptions) {
    this.stdout = streams.stdout;
    this.stderr = streams.stderr;
    this.verbose = !!options?.verbose;
  }

  start(): void {
    // start() writes nothing
  }

  handle(event: EventEnvelope): void {
    // Writes exactly one line to stdout
    this.stdout.write(JSON.stringify(event) + "\n");

    // If verbose, write human-readable block to stderr
    if (this.verbose) {
      const verboseBlock = renderVerboseEvent(event);
      if (verboseBlock) {
        this.stderr.write(verboseBlock);
      }
    }
  }

  finish(): void {
    // finish() writes nothing
  }
}
