export function disableDefaultContextMenu(target: Document = document) {
  const preventContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  target.addEventListener("contextmenu", preventContextMenu);

  return () => {
    target.removeEventListener("contextmenu", preventContextMenu);
  };
}
