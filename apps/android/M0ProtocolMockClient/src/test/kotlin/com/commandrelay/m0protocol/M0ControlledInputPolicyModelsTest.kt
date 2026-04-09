package com.commandrelay.m0protocol

import com.commandrelay.m0protocol.models.M0ControlledInputPolicyContext
import com.commandrelay.m0protocol.models.M0SessionCapabilities
import com.commandrelay.m0protocol.models.buildInputPolicyState
import com.commandrelay.m0protocol.models.buildM0ControlledInputPolicyState
import com.commandrelay.m0protocol.models.isInputAllowed
import com.commandrelay.m0protocol.models.isM0ControlledInputAllowed
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class M0ControlledInputPolicyModelsTest {
    private val json: Json = Json {
        encodeDefaults = true
        ignoreUnknownKeys = false
    }

    @Test
    fun buildPolicyStateEnablesInputWhenClientEnabledAndKillSwitchOff() {
        val context = M0ControlledInputPolicyContext(
            globalInputDisabled = false,
            clientInputEnabled = true,
        )

        val state = buildM0ControlledInputPolicyState(context)

        assertTrue(state.inputEnabled)
        assertFalse(state.globalInputDisabled)
        assertTrue(isM0ControlledInputAllowed(context))
    }

    @Test
    fun buildPolicyStateForcesReadOnlyWhenGlobalInputIsDisabled() {
        val context = M0ControlledInputPolicyContext(
            globalInputDisabled = true,
            clientInputEnabled = true,
        )

        val state = buildM0ControlledInputPolicyState(context)

        assertFalse(state.inputEnabled)
        assertTrue(state.globalInputDisabled)
        assertFalse(isM0ControlledInputAllowed(context))
    }

    @Test
    fun iosNamedAliasesBehaveLikeM0Helpers() {
        val context = M0ControlledInputPolicyContext(
            globalInputDisabled = false,
            clientInputEnabled = true,
        )

        assertEquals(
            buildM0ControlledInputPolicyState(context),
            buildInputPolicyState(context),
        )
        assertEquals(
            isM0ControlledInputAllowed(context),
            isInputAllowed(context),
        )
    }

    @Test
    fun sessionCapabilitiesEncodeWithIosCamelCaseFieldNames() {
        val capabilities = M0SessionCapabilities(
            readOnly = true,
            canEnableInput = true,
        )

        val encoded = json.encodeToString(M0SessionCapabilities.serializer(), capabilities)

        assertTrue(encoded.contains("\"readOnly\":true"))
        assertTrue(encoded.contains("\"canEnableInput\":true"))
    }

    @Test
    fun sessionCapabilitiesRoundTripEncodingPreservesValues() {
        val capabilities = M0SessionCapabilities(
            readOnly = false,
            canEnableInput = true,
        )

        val encoded = json.encodeToString(M0SessionCapabilities.serializer(), capabilities)
        val decoded = json.decodeFromString(M0SessionCapabilities.serializer(), encoded)

        assertEquals(capabilities, decoded)
    }
}
