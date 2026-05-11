#!/usr/bin/env swift

import EventKit
import Foundation

struct TechWeekEvent: Decodable {
    let calendar_block_id: String
    let techweek_id: String
    let partiful_id: String
    let rerank_id: String
    let entry_type: String
    let status: String
    let category: String
    let title: String
    let location: String
    let start: String
    let end: String
    let notes: String
    let url: String
}

let targetCalendarTitle = "Personal"
let preferredSourceHint = "pavlovcik@gmail.com"
let jsonPath = CommandLine.arguments.dropFirst().first ?? "techweek_google_schedule_eventkit.json"

let decoder = JSONDecoder()
let payload = try Data(contentsOf: URL(fileURLWithPath: jsonPath))
let techWeekEvents = try decoder.decode([TechWeekEvent].self, from: payload)

let dateFormatter = DateFormatter()
dateFormatter.locale = Locale(identifier: "en_US_POSIX")
dateFormatter.timeZone = TimeZone(identifier: "America/New_York")
dateFormatter.dateFormat = "yyyy-MM-dd HH:mm"

let store = EKEventStore()

func requestCalendarAccess() async throws -> Bool {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *), status == .fullAccess {
        return true
    }
    if status == .authorized {
        return true
    }
    if status != .notDetermined {
        return false
    }
    if #available(macOS 14.0, *) {
        return try await store.requestFullAccessToEvents()
    }
    return try await withCheckedThrowingContinuation { continuation in
        store.requestAccess(to: .event) { granted, error in
            if let error {
                continuation.resume(throwing: error)
                return
            }
            continuation.resume(returning: granted)
        }
    }
}

guard try await requestCalendarAccess() else {
    throw NSError(
        domain: "TechWeekGoogleSync",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Calendar access was not granted."]
    )
}

let writableMatches = store.calendars(for: .event).filter {
    $0.title == targetCalendarTitle && $0.allowsContentModifications
}

guard let targetCalendar =
    writableMatches.first(where: { $0.source.title.localizedCaseInsensitiveContains(preferredSourceHint) })
    ?? writableMatches.first
else {
    let available = store.calendars(for: .event)
        .filter(\.allowsContentModifications)
        .map { "\($0.title) [source: \($0.source.title)]" }
        .sorted()
        .joined(separator: "\n")
    throw NSError(
        domain: "TechWeekGoogleSync",
        code: 2,
        userInfo: [
            NSLocalizedDescriptionKey: "Could not find writable calendar named \(targetCalendarTitle). Writable calendars:\n\(available)"
        ]
    )
}

guard let windowStart = dateFormatter.date(from: "2026-06-01 00:00"),
      let windowEnd = dateFormatter.date(from: "2026-06-08 00:00")
else {
    fatalError("Could not build sync window dates.")
}

let predicate = store.predicateForEvents(withStart: windowStart, end: windowEnd, calendars: [targetCalendar])
let existingEvents = store.events(matching: predicate)
var deleted = 0
for event in existingEvents where event.title.hasPrefix("[TW-") {
    try store.remove(event, span: .thisEvent, commit: false)
    deleted += 1
}

var created = 0
for row in techWeekEvents {
    guard let start = dateFormatter.date(from: row.start),
          let end = dateFormatter.date(from: row.end)
    else {
        throw NSError(
            domain: "TechWeekGoogleSync",
            code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Could not parse date for \(row.calendar_block_id)."]
        )
    }
    let event = EKEvent(eventStore: store)
    event.calendar = targetCalendar
    event.title = row.title
    event.startDate = start
    event.endDate = end
    event.location = row.location
    event.notes = row.notes
    if let url = URL(string: row.url), !row.url.isEmpty {
        event.url = url
    }
    event.availability = .busy
    try store.save(event, span: .thisEvent, commit: false)
    created += 1
}

try store.commit()

print("Synced \(created) Tech Week operational blocks to \(targetCalendar.title) [source: \(targetCalendar.source.title)]. Deleted \(deleted) prior TW-* blocks.")
