import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

interface SelectTriggerProps {
  className?: string;
  children?: React.ReactNode;
}

interface SelectValueProps {
  placeholder?: string;
}

interface SelectContentProps {
  children?: React.ReactNode;
}

interface SelectItemProps {
  value: string;
  children?: React.ReactNode;
}

interface ParsedItem {
  value: string;
  label: React.ReactNode;
}

function extractSelectConfig(children: React.ReactNode) {
  let triggerClassName = "";
  let placeholder = "";
  const items: ParsedItem[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const element = child as React.ReactElement<SelectTriggerProps | SelectContentProps | { children?: React.ReactNode }>;

    if (element.type === SelectTrigger) {
      const trigger = element as React.ReactElement<SelectTriggerProps>;
      triggerClassName = trigger.props.className ?? "";
      React.Children.forEach(trigger.props.children, (triggerChild) => {
        if (!React.isValidElement(triggerChild)) return;
        const valueElement = triggerChild as React.ReactElement<SelectValueProps>;
        if (valueElement.type === SelectValue) {
          placeholder = valueElement.props.placeholder ?? "";
        }
      });
    }

    if (element.type === SelectContent || element.type === SelectGroup) {
      React.Children.forEach(element.props.children, (contentChild) => {
        if (!React.isValidElement(contentChild)) return;
        const contentElement = contentChild as React.ReactElement<SelectItemProps | { children?: React.ReactNode }>;

        if (contentElement.type === SelectItem) {
          items.push({
            value: (contentElement as React.ReactElement<SelectItemProps>).props.value,
            label: contentElement.props.children
          });
        }

        if (contentElement.type === SelectGroup) {
          React.Children.forEach(contentElement.props.children, (groupChild) => {
            if (!React.isValidElement(groupChild)) return;
            const groupElement = groupChild as React.ReactElement<SelectItemProps>;
            if (groupElement.type === SelectItem) {
              items.push({
                value: groupElement.props.value,
                label: groupElement.props.children
              });
            }
          });
        }
      });
    }
  });

  return { triggerClassName, placeholder, items };
}

function Select({ value = "", onValueChange, children }: SelectProps) {
  const { triggerClassName, placeholder, items } = React.useMemo(
    () => extractSelectConfig(children),
    [children]
  );

  const hasMatchingValue = items.some((item) => item.value === value);
  const currentValue = hasMatchingValue ? value : "";

  return (
    <div className="relative w-full">
      <select
        value={currentValue}
        onChange={(event) => onValueChange?.(event.target.value)}
        className={cn(
          "flex h-10 w-full appearance-none items-center justify-between rounded-full border border-[#DDEAE5] bg-[rgba(255,255,255,0.82)] px-4 py-2 pr-9 text-sm text-[#2F4A43] shadow-[inset_0_1px_0_rgba(255,255,255,0.84)] outline-none ring-offset-background focus:ring-2 focus:ring-[#34C79A]/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#294038] dark:bg-[rgba(19,31,27,0.9)] dark:text-[#D8EEE6]",
          triggerClassName
        )}
      >
        {placeholder ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : null}
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
    </div>
  );
}

function SelectTrigger(_props: SelectTriggerProps) {
  return null;
}

function SelectValue(_props: SelectValueProps) {
  return null;
}

function SelectContent(_props: SelectContentProps) {
  return null;
}

function SelectGroup(props: { children?: React.ReactNode }) {
  return <>{props.children}</>;
}

function SelectItem(_props: SelectItemProps) {
  return null;
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
};
