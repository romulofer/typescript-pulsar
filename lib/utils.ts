export function handlePromise(promise: Promise<unknown> | undefined): void {
  if (promise === undefined) return
  if (typeof promise.catch !== "function") {
    atom.notifications.addFatalError(
      "Atom-Typescript: non-promise passed to handlePromise. Please report this.",
      {
        stack: new Error().stack,
        dismissable: true,
      },
    )
    return
  }
  promise.catch((err: Error) => {
    atom.notifications.addFatalError(`Atom-Typescript error: ${err.message}`, {
      detail: err.toString(),
      stack: err.stack,
      dismissable: true,
    })
  })
}
