import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ParameterSelect, type ParameterSelectOption } from "./ParameterSelect";

const options: ParameterSelectOption[] = [
  { value: "auto", label: "Авто" },
  { value: "720", label: "1280×720 (HD)" },
  { value: "1080", label: "1920×1080 (Full HD)" },
];

describe("ParameterSelect", () => {
  it("uses the shared chevron geometry and rotates it while open", async () => {
    render(<ControlledSelect />);

    const trigger = screen.getByRole("combobox", { name: "Разрешение" });
    const chevron = trigger.querySelector(".chevron-icon");
    expect(chevron).not.toBeNull();
    expect(chevron?.querySelector("path")).toHaveAttribute("d", "m6.5 8 3.5 3.5L13.5 8");
    expect(chevron).not.toHaveClass("expanded");

    await userEvent.click(trigger);

    expect(chevron).toHaveClass("expanded");
  });

  it("opens an accessible menu and selects a value with the pointer", async () => {
    render(<ControlledSelect />);

    const trigger = screen.getByRole("combobox", { name: "Разрешение" });
    await userEvent.click(trigger);
    const menu = await screen.findByRole("listbox", { name: "Разрешение" });

    expect(menu).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "1920×1080 (Full HD)" }));

    expect(trigger).toHaveAttribute("data-value", "1080");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("supports arrow navigation and selection from the keyboard", async () => {
    render(<ControlledSelect />);

    const trigger = screen.getByRole("combobox", { name: "Разрешение" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(trigger).toHaveAttribute("data-value", "720");
    expect(trigger).toHaveFocus();
  });

  it("skips disabled values during keyboard navigation", () => {
    render(<ControlledSelect selectOptions={[
      options[0],
      { ...options[1], disabled: true },
      options[2],
    ]} />);

    const trigger = screen.getByRole("combobox", { name: "Разрешение" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(trigger).toHaveAttribute("data-value", "1080");
  });

  it("does not open when the control is disabled", async () => {
    render(
      <ParameterSelect
        label="Разрешение"
        value="auto"
        options={options}
        onChange={vi.fn()}
        disabled
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Разрешение" });
    expect(trigger).toBeDisabled();
    await userEvent.click(trigger);
    expect(screen.queryByRole("listbox", { name: "Разрешение" })).not.toBeInTheDocument();
  });

  it("shows a two-line grouped option and explains a disabled profile", async () => {
    render(<ControlledSelect selectOptions={[
      { value: "best", label: "Лучшее качество", description: "Автоматический выбор", group: "По качеству" },
      { value: "tv", label: "Smart TV", description: "H.264/AAC", group: "Для устройств", disabled: true, disabledReason: "Нет AAC-аудио" },
    ]} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Разрешение" }));
    expect(screen.getByText("По качеству")).toBeInTheDocument();
    expect(screen.getAllByText("Автоматический выбор")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /Smart TV/i })).toHaveAttribute("title", "Нет AAC-аудио");
  });

  it("anchors the opened menu to its document position while the page scrolls", async () => {
    render(<ControlledSelect />);

    const trigger = screen.getByRole("combobox", { name: "Разрешение" });
    const rect = (top: number, bottom: number): DOMRect => ({
      x: 24, y: top, width: 160, height: bottom - top,
      top, right: 184, bottom, left: 24, toJSON: () => ({}),
    });
    const getBoundingClientRect = vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(rect(20, 52));
    const scrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 120 });

    try {
      await userEvent.click(trigger);
      const menu = await screen.findByRole("listbox", { name: "Разрешение" });
      expect(menu).toHaveStyle({ top: "176px" });

      getBoundingClientRect.mockReturnValue(rect(140, 172));
      fireEvent.scroll(window);

      expect(menu).toHaveStyle({ top: "176px" });
    } finally {
      if (scrollY) Object.defineProperty(window, "scrollY", scrollY);
    }
  });
});

function ControlledSelect({ selectOptions = options }: { selectOptions?: ParameterSelectOption[] }) {
  const [value, setValue] = useState("auto");
  return (
    <ParameterSelect
      label="Разрешение"
      value={value}
      options={selectOptions}
      onChange={setValue}
    />
  );
}
