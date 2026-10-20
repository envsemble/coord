import { useEffect, useRef } from "react";
import { Text } from "@envsemble/envui";
import { ChangeMark } from "../../review/ChangeMark";
import { CHANGE_LABELS } from "../../review/changes";
import { Section } from "./Section";

// A member the inspector was asked to show scrolls into view, highlighted,
// after the inspector has scrolled its new content to the top.
function useReveal(focused) {
  const ref = useRef(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  return ref;
}

export function FocusableRow({ focused, change, children }) {
  const ref = useReveal(focused);
  return (
    <li
      ref={ref}
      className={`member${focused ? " focused" : ""}`}
      data-change={change}
      aria-current={focused ? "true" : undefined}
    >
      {children}
    </li>
  );
}

/** A member's signature, with its description below it when it has one. */
export function Described({ description, children }) {
  if (!description) return children;
  return (
    <span className="member-text">
      {children}
      <Text as="span" variant="supporting" className="member-description">
        {description}
      </Text>
    </span>
  );
}

function MemberRow({ member, method, profile, review, focused }) {
  const status = review ? member.changeStatus : undefined;
  const marked = status && status !== "unchanged";
  const ref = useReveal(focused);
  return (
    <li
      ref={ref}
      className={`member${focused ? " focused" : ""}`}
      data-change={marked ? status : undefined}
      aria-current={focused ? "true" : undefined}
    >
      {review && <ChangeMark status={status} />}
      {marked && (
        <span className="visually-hidden">{CHANGE_LABELS[status]}: </span>
      )}
      <Described description={member.description}>
        <code className="signature">
          {method ? (
            member.type || `${member.name}()`
          ) : (
            <>
              <span className="member-name">
                {member.name}
                {member.optional ? "?" : ""}
              </span>
              {member.type && (
                <span className="member-type">
                  {profile === "database" ? " " : ": "}
                  {member.type}
                  {member.multiplicity ? ` [${member.multiplicity}]` : ""}
                </span>
              )}
            </>
          )}
        </code>
      </Described>
      {member.location && (
        <span
          className="member-line"
          title={`Line ${member.location.startLine}`}
        >
          {member.location.startLine}
        </span>
      )}
    </li>
  );
}

/** Fields and methods, compactly, with change marks while reviewing a proposal. */
export function Members({ element, profile, review, focus = null }) {
  const fields = element.attributes || [],
    methods = element.methods || [];
  if (!fields.length && !methods.length) return null;
  const marks = review && element.changeStatus === "modified";
  const fieldTitle =
    element.stereotype === "enum"
      ? "Members"
      : profile === "code"
        ? "Fields"
        : "Attributes";
  return (
    <>
      {fields.length > 0 && (
        <Section title={`${fieldTitle} · ${fields.length}`} label={fieldTitle}>
          <ul className={`member-list${marks ? " marked" : ""}`}>
            {fields.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                profile={profile}
                review={marks}
                focused={member.id === focus}
              />
            ))}
          </ul>
        </Section>
      )}
      {methods.length > 0 && (
        <Section title={`Methods · ${methods.length}`} label="Methods">
          <ul className={`member-list${marks ? " marked" : ""}`}>
            {methods.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                method
                profile={profile}
                review={marks}
                focused={member.id === focus}
              />
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
