package com.commandrelay.m0protocol

import com.commandrelay.m0protocol.models.M0RelaySessionSummary
import com.commandrelay.m0protocol.models.M0SessionListQuery
import com.commandrelay.m0protocol.models.RelaySessionSummary
import com.commandrelay.m0protocol.models.SessionListQuery
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class M0SessionListDomainModelsTest {
    private val json: Json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    @Test
    fun sessionListQueryDefaultsMatchIosSemantics() {
        val query = M0SessionListQuery()

        assertEquals("", query.searchText)
        assertFalse(query.includeArchived)
    }

    @Test
    fun sessionListQueryEncodingUsesIosCamelCaseFieldNames() {
        val query = M0SessionListQuery(
            searchText = "worker",
            includeArchived = true,
        )

        val encoded = json.encodeToString(M0SessionListQuery.serializer(), query)

        assertTrue(encoded.contains("\"searchText\":\"worker\""))
        assertTrue(encoded.contains("\"includeArchived\":true"))
    }

    @Test
    fun relaySessionSummaryRoundTripEncodingPreservesFields() {
        val summary = M0RelaySessionSummary(
            id = "session-1",
            title = "Web API",
            host = "prod-web-01",
            readOnly = true,
        )

        val encoded = json.encodeToString(M0RelaySessionSummary.serializer(), summary)
        val decoded = json.decodeFromString(M0RelaySessionSummary.serializer(), encoded)

        assertEquals(summary, decoded)
    }

    @Test
    fun iosNamedAliasesPreserveModelSemantics() {
        val query: SessionListQuery = M0SessionListQuery(searchText = "api", includeArchived = false)
        val summary: RelaySessionSummary = M0RelaySessionSummary(
            id = "session-7",
            title = "API",
            host = "prod-api-01",
            readOnly = true,
        )

        assertEquals("api", query.searchText)
        assertEquals("session-7", summary.id)
        assertTrue(summary.readOnly)
    }
}
