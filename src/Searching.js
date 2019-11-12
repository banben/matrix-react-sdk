/*
Copyright 2019 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import EventIndexPeg from "./EventIndexPeg";
import MatrixClientPeg from "./MatrixClientPeg";

function serverSideSearch(term, roomId = undefined) {
    let filter;
    if (roomId !== undefined) {
        filter = {
        // XXX: it's unintuitive that the filter for searching doesn't have the same shape as the v2 filter API :(
            rooms: [roomId],
        };
    }

    let searchPromise = MatrixClientPeg.get().searchRoomEvents({
        filter: filter,
        term: term,
    });

    return searchPromise;
}

function eventIndexSearch(term, roomId = undefined) {
    const combinedSearchFunc = async (searchTerm) => {
        // Create two promises, one for the local search, one for the
        // server-side search.
        const client = MatrixClientPeg.get();
        const serverSidePromise = serverSideSearch(searchTerm);
        const localPromise = localSearchFunc(searchTerm);

        // Wait for both promises to resolve.
        await Promise.all([serverSidePromise, localPromise]);

        // Get both search results.
        const localResult = await localPromise;
        const serverSideResult = await serverSidePromise;

        // Combine the search results into one result.
        const result = {};

        // Our localResult and serverSideResult are both ordered by
        // recency separetly, when we combine them the order might not
        // be the right one so we need to sort them.
        const compare = (a, b) => {
            const aEvent = a.context.getEvent().event;
            const bEvent = b.context.getEvent().event;

            if (aEvent.origin_server_ts >
                bEvent.origin_server_ts) return -1;
            if (aEvent.origin_server_ts <
                bEvent.origin_server_ts) return 1;
            return 0;
        };

        result.count = localResult.count + serverSideResult.count;
        result.results = localResult.results.concat(
            serverSideResult.results).sort(compare);
        result.highlights = localResult.highlights.concat(
            serverSideResult.highlights);

        return result;
    };

    const localSearchFunc = async (searchTerm, roomId = undefined) => {
        const searchArgs = {
            search_term: searchTerm,
            before_limit: 1,
            after_limit: 1,
            order_by_recency: true,
        };

        if (roomId !== undefined) {
            searchArgs.room_id = roomId;
        }

        const eventIndex = EventIndexPeg.get();

        const localResult = await eventIndex.search(searchArgs);

        const response = {
            search_categories: {
                room_events: localResult,
            },
        };

        const emptyResult = {
            results: [],
            highlights: [],
        };

        const result = MatrixClientPeg.get()._processRoomEventsSearch(
            emptyResult, response);

        return result;
    };

    let searchPromise;

    if (roomId !== undefined) {
        if (MatrixClientPeg.get().isRoomEncrypted(roomId)) {
            // The search is for a single encrypted room, use our local
            // search method.
            searchPromise = localSearchFunc(term, roomId);
        } else {
            // The search is for a single non-encrypted room, use the
            // server-side search.
            searchPromise = serverSideSearch(term, roomId);
        }
    } else {
        // Search across all rooms, combine a server side search and a
        // local search.
        searchPromise = combinedSearchFunc(term);
    }

    return searchPromise
}

export default function eventSearch(term, roomId = undefined) {
    const eventIndex = EventIndexPeg.get();

    if (eventIndex === null) return serverSideSearch(term, roomId);
    else return eventIndexSearch(term, roomId);
}